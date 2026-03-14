/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ILiquidModuleRegistry } from '../common/liquidModule.js';
import { ICompositionEngine } from './liquidCompositor.js';
import {
	ILanguageModelToolsService,
	IToolData,
	IToolImpl,
	IToolInvocation,
	IToolResult,
	CountTokensCallback,
	ToolProgress,
} from '../../chat/common/tools/languageModelToolsService.js';

/**
 * Definition shape for a Phonon Liquid tool.
 * Each tool is a pure query against the registry and/or compositor.
 */
export interface ILiquidToolDef {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly inputSchema: object;
	invoke(
		params: Record<string, unknown>,
		registry: ILiquidModuleRegistry,
		compositor: ICompositionEngine,
		token: CancellationToken,
	): Promise<IToolResult>;
}

const phonon_list_grafts: ILiquidToolDef = {
	id: 'phonon.liquid.listGrafts',
	name: 'phonon_list_grafts',
	description: 'List available grafts in the Phonon module registry. Optionally filter by domain, category, entity, or tag. Returns an array of graft objects with id, label, description, domain, category, tags, shows, and tokenWeight.',
	inputSchema: {
		type: 'object',
		properties: {
			domain: { type: 'string', description: 'Filter by business domain (e.g. "operativo", "analytics")' },
			category: { type: 'string', description: 'Filter by UI category (stat, table, detail, chart, form, list)' },
			entity: { type: 'string', description: 'Filter by entity ID - returns grafts whose shows array includes this entity' },
			tag: { type: 'string', description: 'Filter by tag (e.g. "analytics", "traffic", "heatmap")' },
		},
	},
	async invoke(params, registry) {
		let grafts = [...registry.grafts];

		const domain = params.domain as string | undefined;
		const category = params.category as string | undefined;
		const entity = params.entity as string | undefined;
		const tag = params.tag as string | undefined;

		if (domain) {
			grafts = grafts.filter(g => g.domain === domain);
		}
		if (category) {
			grafts = grafts.filter(g => g.category === category);
		}
		if (entity) {
			grafts = grafts.filter(g => g.shows.includes(entity));
		}
		if (tag) {
			grafts = grafts.filter(g => g.tags.includes(tag));
		}

		const result = grafts.map(g => ({
			id: g.id,
			label: g.label,
			description: g.description,
			domain: g.domain,
			category: g.category,
			tags: g.tags,
			shows: g.shows,
			tokenWeight: g.tokenWeight,
		}));

		return { content: [{ kind: 'text' as const, value: JSON.stringify(result) }] };
	},
};

const phonon_get_schema: ILiquidToolDef = {
	id: 'phonon.liquid.getSchema',
	name: 'phonon_get_schema',
	description: 'Get the JSON Schema for a registered entity. Returns the entity ID, label, and full schema object.',
	inputSchema: {
		type: 'object',
		properties: {
			entityId: { type: 'string', description: 'The entity ID to look up (e.g. "dish", "order", "service")' },
		},
		required: ['entityId'],
	},
	async invoke(params, registry) {
		const entityId = params.entityId as string | undefined;
		if (!entityId) {
			return { content: [{ kind: 'text' as const, value: JSON.stringify({ error: 'entityId is required' }) }] };
		}

		const entity = registry.entities.find(e => e.id === entityId);
		if (!entity) {
			return { content: [{ kind: 'text' as const, value: JSON.stringify({ error: `Entity "${entityId}" not found` }) }] };
		}

		return {
			content: [{
				kind: 'text' as const,
				value: JSON.stringify({ id: entity.id, label: entity.label, schema: entity.schema }),
			}],
		};
	},
};

/** All Phonon Liquid tool definitions. Exported for testing. */
export const LIQUID_TOOLS: readonly ILiquidToolDef[] = [
	phonon_list_grafts,
	phonon_get_schema,
];

/**
 * Registers Phonon Liquid tools with ILanguageModelToolsService.
 * These tools give agents structured access to the Graft Kit registry
 * for discovering, querying, and composing grafts.
 *
 * Pattern: same as PhononPlaywrightMcpTools.
 */
export class PhononLiquidTools extends Disposable {

	constructor(
		@ILanguageModelToolsService private readonly toolsService: ILanguageModelToolsService,
		@ILiquidModuleRegistry private readonly registry: ILiquidModuleRegistry,
		@ICompositionEngine private readonly compositor: ICompositionEngine,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this._registerAll();
	}

	private _registerAll(): void {
		const disposables = this._register(new DisposableStore());

		for (const toolDef of LIQUID_TOOLS) {
			const toolData: IToolData = {
				id: toolDef.id,
				source: { type: 'internal', label: 'Phonon Liquid' },
				toolReferenceName: toolDef.name,
				displayName: toolDef.name,
				modelDescription: toolDef.description,
				inputSchema: toolDef.inputSchema as IToolData['inputSchema'],
				tags: ['phonon', 'liquid'],
				canBeReferencedInPrompt: true,
			};

			const registry = this.registry;
			const compositor = this.compositor;

			const impl: IToolImpl = {
				async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, token: CancellationToken): Promise<IToolResult> {
					const params = (invocation.parameters ?? {}) as Record<string, unknown>;
					return toolDef.invoke(params, registry, compositor, token);
				},
			};

			disposables.add(this.toolsService.registerTool(toolData, impl));
		}

		this.logService.info(`[Phonon Liquid Tools] Registered ${LIQUID_TOOLS.length} tools`);
	}
}
