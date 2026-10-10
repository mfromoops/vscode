/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/detachedViews.css';
import { $, append, Dimension, getActiveWindow, show } from '../../../base/browser/dom.js';
import { Codicon } from '../../../base/common/codicons.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { toAction } from '../../../base/common/actions.js';
import { Disposable, DisposableMap, DisposableStore } from '../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../nls.js';
import { Categories } from '../../../platform/action/common/actionCommonCategories.js';
import { Action2, MenuId, registerAction2 } from '../../../platform/actions/common/actions.js';
import { WorkbenchToolBar } from '../../../platform/actions/browser/toolbar.js';
import { createDecorator, IInstantiationService, ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { IContextKeyService } from '../../../platform/contextkey/common/contextkey.js';
import { ServiceCollection } from '../../../platform/instantiation/common/serviceCollection.js';
import { ActiveAuxiliaryContext, ActivePanelContext, ActiveViewletContext, IsAuxiliaryWindowContext } from '../../common/contextkeys.js';
import { INotificationService } from '../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../platform/storage/common/storage.js';
import { IViewDescriptorService, ViewContainerLocation } from '../../common/views.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { IAuxiliaryWindow, IAuxiliaryWindowOpenOptions, IAuxiliaryWindowService } from '../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { IExtensionService } from '../../services/extensions/common/extensions.js';
import { ILifecycleService } from '../../services/lifecycle/common/lifecycle.js';
import { IPaneCompositePartService } from '../../services/panecomposite/browser/panecomposite.js';
import { IViewsService } from '../../services/views/common/viewsService.js';
import { PaneComposite } from '../panecomposite.js';

interface DetachedViewOrigin {
	viewId: string;
	containerId: string;
}

interface DetachedViewState {
	id: string;
	options: IAuxiliaryWindowOpenOptions;
	origin?: DetachedViewOrigin;
}

interface DetachedView {
	window: IAuxiliaryWindow;
	returnToMain(reveal: boolean): void;
}

const IDetachedViewsService = createDecorator<IDetachedViewsService>('detachedViewsService');
interface IDetachedViewsService {
	readonly _serviceBrand: undefined;
	detach(id: string, options?: IAuxiliaryWindowOpenOptions): Promise<void>;
	detachView(viewId: string): Promise<void>;
	reattach(id?: string): void;
	restore(): Promise<void>;
}

/** Owns auxiliary windows; composites and extension hosts remain in the original workbench. */
class DetachedViewsService extends Disposable implements IDetachedViewsService {
	declare readonly _serviceBrand: undefined;
	private static readonly storageKey = 'workbench.detachedViewContainers';
	private readonly origins = new Map<string, DetachedViewOrigin>();
	private readonly pendingViews = new Set<string>();
	private readonly detached = new Map<string, DetachedView>();
	private readonly windowDisposables = this._register(new DisposableMap<string, DisposableStore>());
	private readonly pending = new Map<string, Promise<void>>();
	private shuttingDown = false;

	constructor(
		@IPaneCompositePartService private readonly parts: IPaneCompositePartService,
		@IViewDescriptorService private readonly descriptors: IViewDescriptorService,
		@IAuxiliaryWindowService private readonly windows: IAuxiliaryWindowService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService private readonly contextKeys: IContextKeyService,
		@IStorageService private readonly storage: IStorageService,
		@ILifecycleService lifecycle: ILifecycleService,
		@IExtensionService private readonly extensions: IExtensionService,
		@INotificationService private readonly notifications: INotificationService,
	) {
		super();
		this._register(storage.onWillSaveState(() => this.save()));
		this._register(lifecycle.onWillShutdown(() => {
			this.save();
			this.shuttingDown = true;
		}));
	}

	detach(id: string, options?: IAuxiliaryWindowOpenOptions): Promise<void> {
		const existing = this.detached.get(id);
		if (existing) {
			existing.window.window.focus();
			return Promise.resolve();
		}
		const pending = this.pending.get(id);
		if (pending) {
			return pending;
		}
		const operation = this.doDetach(id, options).finally(() => this.pending.delete(id));
		this.pending.set(id, operation);
		return operation;
	}

	/** Uses the existing view move API to isolate a movable subview in its own container. */
	async detachView(viewId: string): Promise<void> {
		if (this.pendingViews.has(viewId)) {
			return;
		}
		const view = this.descriptors.getViewDescriptorById(viewId);
		const source = this.descriptors.getViewContainerByViewId(viewId);
		const location = source && this.descriptors.getViewContainerLocation(source);
		if (!view || !source || location === null || location === undefined) {
			return;
		}
		if (this.descriptors.getViewContainerModel(source).allViewDescriptors.length === 1) {
			return this.detach(source.id);
		}
		if (!view.canMoveView || !this.descriptors.canMoveViews()) {
			this.notifications.info(localize('cannotDetachView', "This view must move with its container. Use 'Move View Container to New Window' instead."));
			return;
		}
		this.pendingViews.add(viewId);
		try {
			this.descriptors.moveViewToLocation(view, location, 'detachView');
			const target = this.descriptors.getViewContainerByViewId(viewId);
			if (!target || target.id === source.id) {
				return;
			}
			this.origins.set(target.id, { viewId, containerId: source.id });
			try {
				await this.detach(target.id);
			} finally {
				if (!this.detached.has(target.id)) {
					this.restoreOrigin(target.id);
				}
			}
		} finally {
			this.pendingViews.delete(viewId);
		}
	}

	private restoreOrigin(id: string): string {
		const origin = this.origins.get(id);
		this.origins.delete(id);
		if (origin) {
			const view = this.descriptors.getViewDescriptorById(origin.viewId);
			const source = this.descriptors.getViewContainerById(origin.containerId);
			if (view && source && this.descriptors.getViewContainerByViewId(view.id)?.id === id) {
				this.descriptors.moveViewsToContainer([view], source, undefined, 'reattachView');
				return source.id;
			}
		}
		return id;
	}

	private async doDetach(id: string, options?: IAuxiliaryWindowOpenOptions): Promise<void> {
		const descriptor = this.descriptors.getViewContainerById(id);
		const location = descriptor && this.descriptors.getViewContainerLocation(descriptor);
		if (!descriptor || location === null || location === undefined) {
			return;
		}
		// Open the window first: a blocked popup must not take a view away from its owner.
		const disposables = new DisposableStore();
		this.windowDisposables.set(id, disposables);
		try {
			const window = disposables.add(await this.windows.open({ ...options, nativeTitlebar: true }));
			await Promise.race([
				window.whenStylesHaveLoaded,
				new Promise<void>(resolve => disposables.add(window.onUnload(resolve)))
			]);
			if (window.window.closed || this.shuttingDown || this.descriptors.getViewContainerLocation(descriptor) !== location) {
				this.windowDisposables.deleteAndDispose(id);
				return;
			}
			await this.parts.openPaneComposite(id, location);
			let returned = false;
			let restoreContext = () => { };
			const returnToMain = (reveal: boolean) => {
				if (returned) {
					return;
				}
				returned = true;
				this.detached.delete(id);
				restoreContext();
				lease?.dispose();
				// Adopt back before the child document is destroyed. Keep hidden views alive.
				if (lease) {
					originalDocument.adoptNode(lease.container);
				}
				this.windowDisposables.deleteAndDispose(id);
				if (!this.shuttingDown) {
					const targetId = this.restoreOrigin(id);
					const target = this.descriptors.getViewContainerById(targetId);
					const targetLocation = target && this.descriptors.getViewContainerLocation(target);
					this.save();
					if (reveal && targetLocation !== null && targetLocation !== undefined) {
						void this.parts.openPaneComposite(targetId, targetLocation, true);
					}
				}
			};
			const lease = this.parts.detachPaneComposite?.(id, location, () => {
				window.window.focus();
				lease?.composite.focus();
			}, () => returnToMain(false));
			if (!lease) {
				this.windowDisposables.deleteAndDispose(id);
				return;
			}
			const originalDocument = lease.container.ownerDocument;
			this.detached.set(id, { window, returnToMain });
			const composite = lease.composite as PaneComposite;
			const part = append(window.container, $('.part.detached-view', { role: 'region', 'aria-label': descriptor.title.value }));
			part.classList.add(location === ViewContainerLocation.Panel ? 'panel' : 'sidebar');
			const contextKeys = disposables.add(this.contextKeys.createScoped(part));
			IsAuxiliaryWindowContext.bindTo(contextKeys).set(true);
			(location === ViewContainerLocation.Panel ? ActivePanelContext : location === ViewContainerLocation.Sidebar ? ActiveViewletContext : ActiveAuxiliaryContext).bindTo(contextKeys).set(id);
			const viewContainer = composite.getViewPaneContainer();
			const updateContext = () => {
				for (const pane of viewContainer?.panes ?? []) {
					pane.setParentContextKeyService(contextKeys);
				}
			};
			if (viewContainer) {
				disposables.add(viewContainer.onDidAddViews(updateContext));
			}
			updateContext();
			restoreContext = () => {
				for (const pane of viewContainer?.panes ?? []) {
					pane.setParentContextKeyService();
				}
			};
			const scopedInstantiation = disposables.add(this.instantiationService.createChild(new ServiceCollection([IContextKeyService, contextKeys])));
			const title = append(part, $('.composite.title'));
			const label = append(title, $('span.detached-view-label'));
			const actions = append(title, $('.title-actions'));
			const toolbar = disposables.add(scopedInstantiation.createInstance(WorkbenchToolBar, actions, {
				actionViewItemProvider: (action, itemOptions) => composite.getActionViewItem(action, itemOptions),
			}));
			toolbar.actionRunner = composite.getActionRunner();
			const updateTitle = () => {
				label.textContent = composite.getTitle() ?? descriptor.title.value;
				window.window.document.title = localize('detachedTitle', "{0} — Code - OSS", label.textContent);
				toolbar.context = composite.getActionsContext();
				toolbar.setActions([...composite.getActions(), toAction({
					id: 'workbench.action.reattachViewContainer',
					label: localize('returnView', "Move Back to Main Window"),
					class: ThemeIcon.asClassName(Codicon.arrowLeft),
					run: () => returnToMain(true)
				})], [...composite.getSecondaryActions()]);
			};
			disposables.add(composite.onTitleAreaUpdate(updateTitle));
			disposables.add(toolbar.actionRunner.onDidRun(e => {
				if (e.error) {
					this.notifications.error(e.error);
				}
			}));
			updateTitle();
			const content = append(part, $('.content'));
			content.appendChild(lease.container);
			show(lease.container);
			composite.setBoundarySashes({});
			composite.setVisible(true);
			disposables.add(window.onDidLayout(dimension => {
				composite.layout(new Dimension(dimension.width, Math.max(0, dimension.height - title.offsetHeight)));
			}));
			disposables.add(window.onUnload(() => returnToMain(true)));
			window.layout();
			window.window.focus();
			composite.focus();
			this.save();
		} catch (error) {
			this.detached.get(id)?.returnToMain(true);
			this.windowDisposables.deleteAndDispose(id);
			throw error;
		}
	}

	reattach(id?: string): void {
		const view = id ? this.detached.get(id) : [...this.detached.values()].find(view => view.window.window === getActiveWindow());
		view?.returnToMain(true);
	}

	private save(): void {
		if (!this.shuttingDown) {
			const state: DetachedViewState[] = [...this.detached].map(([id, value]) => ({ id, options: value.window.createState(), origin: this.origins.get(id) }));
			this.storage.store(DetachedViewsService.storageKey, state, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}
	}

	async restore(): Promise<void> {
		await this.extensions.whenInstalledExtensionsRegistered();
		const state = this.storage.getObject<DetachedViewState[]>(DetachedViewsService.storageKey, StorageScope.WORKSPACE, []);
		if (!Array.isArray(state)) {
			return;
		}
		for (const entry of state) {
			if (entry && typeof entry.id === 'string') {
				try {
					if (entry.origin && typeof entry.origin.viewId === 'string' && typeof entry.origin.containerId === 'string') {
						this.origins.set(entry.id, entry.origin);
					}
					await this.detach(entry.id, entry.options);
				} catch (error) {
					this.notifications.error(error);
				}
			}
		}
	}

	override dispose(): void {
		this.save();
		this.shuttingDown = true;
		for (const view of this.detached.values()) {
			view.returnToMain(false);
		}
		super.dispose();
	}
}

registerSingleton(IDetachedViewsService, DetachedViewsService, InstantiationType.Delayed);

class RestoreDetachedViews {
	constructor(@IDetachedViewsService service: IDetachedViewsService) {
		void service.restore();
	}
}
registerWorkbenchContribution2('workbench.restoreDetachedViews', RestoreDetachedViews, WorkbenchPhase.AfterRestored);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.detachViewContainer',
			title: localize2('detachViewContainer', "Move View Container to New Window..."),
			category: Categories.View,
			f1: true,
			menu: { id: MenuId.ViewTitleContext, group: '3_window', order: 1 }
		});
	}
	async run(accessor: ServicesAccessor, context?: { viewId?: string }): Promise<void> {
		const descriptors = accessor.get(IViewDescriptorService);
		const service = accessor.get(IDetachedViewsService);
		const quickInput = accessor.get(IQuickInputService);
		const selected = context?.viewId ? descriptors.getViewContainerByViewId(context.viewId) : undefined;
		const id = selected?.id ?? (await quickInput.pick(descriptors.viewContainers
			.filter(container => !container.hideIfEmpty || descriptors.getViewContainerModel(container).activeViewDescriptors.length > 0)
			.map(container => ({ id: container.id, label: container.title.value })), {
			placeHolder: localize('selectDetachedView', "Select a view container to move to its own window")
		}))?.id;
		if (id) {
			await service.detach(id);
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.reattachViewContainer',
			title: localize2('reattachViewContainer', "Move View Container Back to Main Window"),
			category: Categories.View,
			f1: true,
			menu: { id: MenuId.ViewTitleContext, group: '3_window', order: 2 }
		});
	}
	run(accessor: ServicesAccessor, context?: { viewId?: string }): void {
		const views = accessor.get(IViewsService);
		const descriptors = accessor.get(IViewDescriptorService);
		const id = context?.viewId ?? views.getFocusedView()?.id;
		const container = id ? descriptors.getViewContainerByViewId(id) : undefined;
		accessor.get(IDetachedViewsService).reattach(container?.id);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.detachView',
			title: localize2('detachView', "Move View to New Window..."),
			category: Categories.View,
			f1: true,
			menu: { id: MenuId.ViewTitleContext, group: '3_window', order: 0 }
		});
	}
	async run(accessor: ServicesAccessor, context?: { viewId?: string }): Promise<void> {
		const descriptors = accessor.get(IViewDescriptorService);
		const service = accessor.get(IDetachedViewsService);
		const quickInput = accessor.get(IQuickInputService);
		const id = context?.viewId ?? (await quickInput.pick(descriptors.viewContainers.flatMap(container =>
			descriptors.getViewContainerModel(container).activeViewDescriptors.map(view => ({ id: view.id, label: view.name.value, description: container.title.value }))
		), { placeHolder: localize('selectViewWindow', "Select a view to move to its own window") }))?.id;
		if (id) {
			await service.detachView(id);
		}
	}
});
