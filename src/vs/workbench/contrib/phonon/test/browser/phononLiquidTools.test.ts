/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { LiquidModuleRegistry } from '../../browser/liquidModuleRegistry.js';
import { CompositionEngine } from '../../browser/liquidCompositor.js';
import { LIQUID_TOOLS } from '../../browser/phononLiquidTools.js';
import type { ILiquidGraft, ILiquidEntity } from '../../common/liquidGraftTypes.js';

function makeGraft(overrides: Partial<ILiquidGraft> & { id: string; label: string }): ILiquidGraft {
	return {
		entryUri: URI.parse(`test://${overrides.id}`),
		description: '',
		domain: 'general',
		category: 'detail',
		tags: [],
		layout: { minCols: 4, maxCols: 12, minHeight: 150 },
		extensionId: 'test.ext',
		shows: [],
		relatesTo: [],
		tokenWeight: 0,
		...overrides,
	};
}

function makeEntity(overrides: Partial<ILiquidEntity> & { id: string; label: string }): ILiquidEntity {
	return {
		schema: { type: 'object', properties: {} },
		icon: undefined,
		extensionId: 'test.ext',
		...overrides,
	};
}

function findTool(name: string) {
	const tool = LIQUID_TOOLS.find(t => t.name === name);
	if (!tool) {
		throw new Error(`Tool ${name} not found`);
	}
	return tool;
}

async function invokeTool(name: string, params: Record<string, unknown>, registry: LiquidModuleRegistry, compositor: CompositionEngine): Promise<string> {
	const tool = findTool(name);
	const result = await tool.invoke(params, registry, compositor, CancellationToken.None);
	const textPart = result.content.find(p => p.kind === 'text');
	return (textPart as { value: string })?.value ?? '';
}

suite('PhononLiquidTools', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let registry: LiquidModuleRegistry;
	let compositor: CompositionEngine;

	setup(() => {
		registry = store.add(new LiquidModuleRegistry());
		compositor = store.add(new CompositionEngine(registry, new NullLogService()));
	});

	suite('phonon_list_grafts', () => {

		test('returns all grafts when no filters', async () => {
			registry.updateGrafts([
				makeGraft({ id: 'g1', label: 'One', domain: 'ops' }),
				makeGraft({ id: 'g2', label: 'Two', domain: 'food' }),
			]);
			const raw = await invokeTool('phonon_list_grafts', {}, registry, compositor);
			const result = JSON.parse(raw);
			assert.strictEqual(result.length, 2);
		});

		test('filters by domain', async () => {
			registry.updateGrafts([
				makeGraft({ id: 'g1', label: 'One', domain: 'ops' }),
				makeGraft({ id: 'g2', label: 'Two', domain: 'food' }),
				makeGraft({ id: 'g3', label: 'Three', domain: 'ops' }),
			]);
			const raw = await invokeTool('phonon_list_grafts', { domain: 'ops' }, registry, compositor);
			const result = JSON.parse(raw);
			assert.strictEqual(result.length, 2);
			assert.ok(result.every((g: { domain: string }) => g.domain === 'ops'));
		});

		test('filters by category', async () => {
			registry.updateGrafts([
				makeGraft({ id: 'g1', label: 'One', category: 'stat' }),
				makeGraft({ id: 'g2', label: 'Two', category: 'table' }),
			]);
			const raw = await invokeTool('phonon_list_grafts', { category: 'stat' }, registry, compositor);
			const result = JSON.parse(raw);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].id, 'g1');
		});

		test('filters by entity (shows)', async () => {
			registry.updateGrafts([
				makeGraft({ id: 'g1', label: 'One', shows: ['dish'] }),
				makeGraft({ id: 'g2', label: 'Two', shows: ['order'] }),
				makeGraft({ id: 'g3', label: 'Three', shows: ['dish', 'order'] }),
			]);
			const raw = await invokeTool('phonon_list_grafts', { entity: 'dish' }, registry, compositor);
			const result = JSON.parse(raw);
			assert.strictEqual(result.length, 2);
		});

		test('filters by tag', async () => {
			registry.updateGrafts([
				makeGraft({ id: 'g1', label: 'One', tags: ['analytics', 'cost'] }),
				makeGraft({ id: 'g2', label: 'Two', tags: ['traffic'] }),
			]);
			const raw = await invokeTool('phonon_list_grafts', { tag: 'analytics' }, registry, compositor);
			const result = JSON.parse(raw);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].id, 'g1');
		});

		test('combines multiple filters (AND logic)', async () => {
			registry.updateGrafts([
				makeGraft({ id: 'g1', label: 'One', domain: 'ops', category: 'stat' }),
				makeGraft({ id: 'g2', label: 'Two', domain: 'ops', category: 'table' }),
				makeGraft({ id: 'g3', label: 'Three', domain: 'food', category: 'stat' }),
			]);
			const raw = await invokeTool('phonon_list_grafts', { domain: 'ops', category: 'stat' }, registry, compositor);
			const result = JSON.parse(raw);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].id, 'g1');
		});

		test('returns empty array when no matches', async () => {
			registry.updateGrafts([
				makeGraft({ id: 'g1', label: 'One', domain: 'ops' }),
			]);
			const raw = await invokeTool('phonon_list_grafts', { domain: 'nonexistent' }, registry, compositor);
			const result = JSON.parse(raw);
			assert.strictEqual(result.length, 0);
		});

		test('includes tokenWeight in output', async () => {
			registry.updateGrafts([
				makeGraft({ id: 'g1', label: 'One', tokenWeight: 500 }),
			]);
			const raw = await invokeTool('phonon_list_grafts', {}, registry, compositor);
			const result = JSON.parse(raw);
			assert.strictEqual(result[0].tokenWeight, 500);
		});
	});

	suite('phonon_get_schema', () => {

		test('returns schema for existing entity', async () => {
			registry.updateEntities([
				makeEntity({
					id: 'dish',
					label: 'Piatto',
					schema: { type: 'object', properties: { name: { type: 'string' }, price: { type: 'number' } } },
				}),
			]);
			const raw = await invokeTool('phonon_get_schema', { entityId: 'dish' }, registry, compositor);
			const result = JSON.parse(raw);
			assert.strictEqual(result.id, 'dish');
			assert.strictEqual(result.label, 'Piatto');
			assert.ok(result.schema.properties.name);
			assert.ok(result.schema.properties.price);
		});

		test('returns error for unknown entity', async () => {
			const raw = await invokeTool('phonon_get_schema', { entityId: 'nonexistent' }, registry, compositor);
			const result = JSON.parse(raw);
			assert.strictEqual(result.error, 'Entity "nonexistent" not found');
		});

		test('returns error when entityId is missing', async () => {
			const raw = await invokeTool('phonon_get_schema', {}, registry, compositor);
			const result = JSON.parse(raw);
			assert.ok(result.error);
		});
	});

	suite('phonon_compose', () => {

		test('composes entities with action and returns intent', async () => {
			registry.updateEntities([
				makeEntity({ id: 'dish', label: 'Piatto' }),
			]);
			registry.updateGrafts([
				makeGraft({ id: 'dishDetail', label: 'Dish Detail', category: 'detail', shows: ['dish'] }),
			]);
			const raw = await invokeTool('phonon_compose', { entities: ['dish'], action: 'show' }, registry, compositor);
			const result = JSON.parse(raw);
			assert.strictEqual(result.layout, 'single');
			assert.strictEqual(result.slots.length, 1);
			assert.strictEqual(result.slots[0].graftId, 'dishDetail');
		});

		test('returns validation error for unknown entity', async () => {
			const raw = await invokeTool('phonon_compose', { entities: ['nonexistent'], action: 'show' }, registry, compositor);
			const result = JSON.parse(raw);
			assert.ok(result.error);
			assert.ok(result.gate !== undefined);
		});

		test('returns validation error for unknown action', async () => {
			registry.updateEntities([
				makeEntity({ id: 'dish', label: 'Piatto' }),
			]);
			const raw = await invokeTool('phonon_compose', { entities: ['dish'], action: 'destroy' }, registry, compositor);
			const result = JSON.parse(raw);
			assert.ok(result.error);
		});

		test('returns error when entities is missing', async () => {
			const raw = await invokeTool('phonon_compose', { action: 'show' }, registry, compositor);
			const result = JSON.parse(raw);
			assert.ok(result.error);
		});

		test('returns error when entities is empty array', async () => {
			const raw = await invokeTool('phonon_compose', { entities: [], action: 'show' }, registry, compositor);
			const result = JSON.parse(raw);
			assert.ok(result.error);
			assert.ok(result.error.includes('at least one'));
		});

		test('respects preferredLayout', async () => {
			registry.updateEntities([
				makeEntity({ id: 'dish', label: 'Piatto' }),
				makeEntity({ id: 'order', label: 'Ordine' }),
			]);
			registry.updateGrafts([
				makeGraft({ id: 'dishDetail', label: 'Dish', category: 'detail', shows: ['dish'] }),
				makeGraft({ id: 'orderTable', label: 'Orders', category: 'table', shows: ['order'] }),
			]);
			const raw = await invokeTool('phonon_compose', {
				entities: ['dish', 'order'],
				action: 'show',
				preferredLayout: 'split-vertical',
			}, registry, compositor);
			const result = JSON.parse(raw);
			assert.strictEqual(result.slots.length, 2);
			assert.strictEqual(result.layout, 'split-vertical');
		});

		test('returns composable intent JSON that matches ICompositionIntent', async () => {
			registry.updateEntities([
				makeEntity({ id: 'dish', label: 'Piatto' }),
			]);
			registry.updateGrafts([
				makeGraft({ id: 'dishStat', label: 'Stats', category: 'stat', shows: ['dish'], tokenWeight: 400 }),
			]);
			const raw = await invokeTool('phonon_compose', { entities: ['dish'], action: 'summarize' }, registry, compositor);
			const result = JSON.parse(raw);
			// Must have layout + slots (ICompositionIntent shape)
			assert.ok(result.layout);
			assert.ok(Array.isArray(result.slots));
			assert.ok(result.title);
		});
	});

	suite('phonon_capabilities', () => {

		test('returns full capability summary', async () => {
			registry.updateEntities([
				makeEntity({ id: 'dish', label: 'Piatto', schema: { type: 'object', properties: { name: { type: 'string' } } } }),
			]);
			registry.updateGrafts([
				makeGraft({ id: 'g1', label: 'One', description: 'First', domain: 'ops', category: 'stat', tags: ['analytics'], shows: ['dish'] }),
			]);
			const raw = await invokeTool('phonon_capabilities', {}, registry, compositor);
			const result = JSON.parse(raw);
			assert.ok(Array.isArray(result.entities));
			assert.ok(Array.isArray(result.grafts));
			assert.ok(Array.isArray(result.views));
			assert.ok(Array.isArray(result.modules));
			assert.strictEqual(result.entities.length, 1);
			assert.strictEqual(result.grafts.length, 1);
			assert.strictEqual(result.entities[0].fields.length, 1);
			assert.strictEqual(result.entities[0].fields[0], 'name');
		});

		test('returns empty summary when registry is empty', async () => {
			const raw = await invokeTool('phonon_capabilities', {}, registry, compositor);
			const result = JSON.parse(raw);
			assert.strictEqual(result.entities.length, 0);
			assert.strictEqual(result.grafts.length, 0);
			assert.strictEqual(result.views.length, 0);
		});
	});
});
