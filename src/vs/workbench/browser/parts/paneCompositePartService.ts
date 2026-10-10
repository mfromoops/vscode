/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { assertReturnsDefined } from '../../../base/common/types.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { IProgressIndicator } from '../../../platform/progress/common/progress.js';
import { PaneComposite, PaneCompositeDescriptor } from '../panecomposite.js';
import { AuxiliaryBarPart } from './auxiliarybar/auxiliaryBarPart.js';
import { PanelPart } from './panel/panelPart.js';
import { SidebarPart } from './sidebar/sidebarPart.js';
import { IPaneComposite } from '../../common/panecomposite.js';
import { ViewContainerLocation } from '../../common/views.js';
import { IPaneCompositePartService } from '../../services/panecomposite/browser/panecomposite.js';
import { Disposable, DisposableStore, toDisposable } from '../../../base/common/lifecycle.js';
import { IPaneCompositePart } from './paneCompositePart.js';
import { SINGLE_WINDOW_PARTS } from '../../services/layout/browser/layoutService.js';

export class PaneCompositePartService extends Disposable implements IPaneCompositePartService {

	declare readonly _serviceBrand: undefined;

	readonly onDidPaneCompositeOpen: Event<{ composite: IPaneComposite; viewContainerLocation: ViewContainerLocation }>;
	readonly onDidPaneCompositeClose: Event<{ composite: IPaneComposite; viewContainerLocation: ViewContainerLocation }>;

	private readonly detachedOpened = this._register(new Emitter<{ composite: IPaneComposite; viewContainerLocation: ViewContainerLocation }>());
	private readonly detachedClosed = this._register(new Emitter<{ composite: IPaneComposite; viewContainerLocation: ViewContainerLocation }>());
	private readonly paneCompositeParts = new Map<ViewContainerLocation, IPaneCompositePart>();

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		const panelPart = instantiationService.createInstance(PanelPart);
		const sideBarPart = instantiationService.createInstance(SidebarPart);
		const auxiliaryBarPart = instantiationService.createInstance(AuxiliaryBarPart);

		this.paneCompositeParts.set(ViewContainerLocation.Panel, panelPart);
		this.paneCompositeParts.set(ViewContainerLocation.Sidebar, sideBarPart);
		this.paneCompositeParts.set(ViewContainerLocation.AuxiliaryBar, auxiliaryBarPart);

		const viewContainerLocations = [ViewContainerLocation.Sidebar, ViewContainerLocation.Panel, ViewContainerLocation.AuxiliaryBar];

		const eventDisposables = this._register(new DisposableStore());
		this.onDidPaneCompositeOpen = Event.any(this.detachedOpened.event, ...viewContainerLocations.map(loc => Event.map(this.paneCompositeParts.get(loc)!.onDidPaneCompositeOpen, composite => { return { composite, viewContainerLocation: loc }; }, eventDisposables)));
		this.onDidPaneCompositeClose = Event.any(this.detachedClosed.event, ...viewContainerLocations.map(loc => Event.map(this.paneCompositeParts.get(loc)!.onDidPaneCompositeClose, composite => { return { composite, viewContainerLocation: loc }; }, eventDisposables)));
	}

	getDetachedPaneComposite(id: string): IPaneComposite | undefined {
		for (const part of this.paneCompositeParts.values()) {
			const composite = part.getDetachedComposite?.(id);
			if (composite) {
				return composite as PaneComposite;
			}
		}
		return undefined;
	}

	closeDetachedPaneComposite(id: string): void {
		for (const part of this.paneCompositeParts.values()) {
			part.closeDetachedComposite?.(id);
		}
	}

	detachPaneComposite(id: string, location: ViewContainerLocation, focus: () => void, release: () => void) {
		const lease = this.getPartByLocation(location).detachComposite?.(id, focus, release);
		if (!lease) {
			return undefined;
		}
		const event = { composite: lease.composite as PaneComposite, viewContainerLocation: location };
		this.detachedOpened.fire(event);
		return Object.assign(toDisposable(() => {
			lease.dispose();
			this.detachedClosed.fire(event);
		}), { composite: lease.composite, container: lease.container });
	}

	getRegistryId(viewContainerLocation: ViewContainerLocation): string {
		return this.getPartByLocation(viewContainerLocation).registryId;
	}

	getPartId(viewContainerLocation: ViewContainerLocation): SINGLE_WINDOW_PARTS {
		return this.getPartByLocation(viewContainerLocation).partId;
	}

	openPaneComposite(id: string | undefined, viewContainerLocation: ViewContainerLocation, focus?: boolean): Promise<IPaneComposite | undefined> {
		return this.getPartByLocation(viewContainerLocation).openPaneComposite(id, focus);
	}

	getActivePaneComposite(viewContainerLocation: ViewContainerLocation): IPaneComposite | undefined {
		return this.getPartByLocation(viewContainerLocation).getActivePaneComposite();
	}

	getPaneComposite(id: string, viewContainerLocation: ViewContainerLocation): PaneCompositeDescriptor | undefined {
		return this.getPartByLocation(viewContainerLocation).getPaneComposite(id);
	}

	getPaneComposites(viewContainerLocation: ViewContainerLocation): PaneCompositeDescriptor[] {
		return this.getPartByLocation(viewContainerLocation).getPaneComposites();
	}

	getPinnedPaneCompositeIds(viewContainerLocation: ViewContainerLocation): string[] {
		return this.getPartByLocation(viewContainerLocation).getPinnedPaneCompositeIds();
	}

	getVisiblePaneCompositeIds(viewContainerLocation: ViewContainerLocation): string[] {
		return this.getPartByLocation(viewContainerLocation).getVisiblePaneCompositeIds();
	}

	getPaneCompositeIds(viewContainerLocation: ViewContainerLocation): string[] {
		return this.getPartByLocation(viewContainerLocation).getPaneCompositeIds();
	}

	getProgressIndicator(id: string, viewContainerLocation: ViewContainerLocation): IProgressIndicator | undefined {
		return this.getPartByLocation(viewContainerLocation).getProgressIndicator(id);
	}

	hideActivePaneComposite(viewContainerLocation: ViewContainerLocation): void {
		this.getPartByLocation(viewContainerLocation).hideActivePaneComposite();
	}

	getLastActivePaneCompositeId(viewContainerLocation: ViewContainerLocation): string {
		return this.getPartByLocation(viewContainerLocation).getLastActivePaneCompositeId();
	}

	private getPartByLocation(viewContainerLocation: ViewContainerLocation): IPaneCompositePart {
		return assertReturnsDefined(this.paneCompositeParts.get(viewContainerLocation));
	}

}

registerSingleton(IPaneCompositePartService, PaneCompositePartService, InstantiationType.Delayed);
