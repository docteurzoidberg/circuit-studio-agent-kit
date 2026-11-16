async () => {
  // Spike test D: build a Circuit Studio project from a structured Markdown wiring document and prepared
  // STEP-derived parts, load it through the Open path, and start an Auto Video export.
  // Inputs are served by a local static server (see spike/serve.py).
  const BASE = 'http://127.0.0.1:8765';
  const { useEditor } = await import('/src/store.ts');
  const { importLegacy } = await import('/src/projectFiles.ts');
  const { exportCinematic } = await import('/src/videoExport.ts');
  const { defaultVideoSettings } = await import('/src/cinematic.ts');
  const { DEVKIT_COMPONENT } = await import('/src/model.ts');

  const markdown = await (await fetch(`${BASE}/reference-project/wiring.md`)).text();
  const PARTS_DIR = window.__spikePartsDir ?? 'parts';  // 'parts-simplified' for the simplified models
  const prepared = await (await fetch(`${BASE}/${PARTS_DIR}/parts.json`)).json();

  // --- Markdown tables: found by their headers, columns matched by name, extra columns ignored.
  const tables = [];
  let current = null;
  for (const line of markdown.split('\n')) {
    if (!line.trim().startsWith('|')) { current = null; continue; }
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    if (cells.every(c => /^:?-+:?$/.test(c))) continue;
    if (!current) { current = { header: cells.map(c => c.toLowerCase()), rows: [] }; tables.push(current); continue; }
    current.rows.push(Object.fromEntries(current.header.map((h, i) => [h, cells[i] ?? ''])));
  }
  const pick = (row, ...names) => names.map(n => row[n]).find(v => v !== undefined) ?? '';
  const partsTable = tables.find(t => t.header.includes('part') && t.header.includes('name'));
  const wiresTable = tables.find(t => t.header.some(h => ['from', 'source'].includes(h)) && t.header.some(h => ['to', 'destination'].includes(h)));

  // --- Layout is not part of the document; for the spike it is a fixed table (mm, degrees).
  const layout = {
    Board: { at: [0, 0], rot: 0 }, 'Session gauge': { at: [-40, -105], rot: 0 }, 'Week gauge': { at: [40, -105], rot: 0 },
    Display: { at: [0, 90], rot: 180 }, Strip: { at: [-100, 80], rot: 0 }, D1: { at: [-100, 62], rot: 0 },
    Buck: { at: [-95, -40], rot: 0 }, Fuse: { at: [-150, -35], rot: 0 }, 'Power socket': { at: [-150, -95], rot: 0 },
  };
  const devkitLabels = Object.fromEntries(DEVKIT_COMPONENT.pins.map(p => [p.id, p]));
  const assets = {};
  const toBase64 = async url => {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  };

  const components = {};
  for (const row of partsTable.rows) {
    const name = pick(row, 'name'), partRef = pick(row, 'part'), id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const place = layout[name] ?? { at: [0, 0], rot: 0 };
    const standIn = partRef.match(/^stand-in (\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
    let component;
    if (standIn) {
      const [w, h, t] = standIn.slice(1).map(Number);
      const labels = pick(row, 'pins').split(',').map(s => s.trim()).filter(Boolean);
      component = { id, modelId: 'generic-pcb', name, rotation: [0, 0, place.rot], dimensions: [w, h, t],
        geometry: { kind: 'procedural-pcb', quality: 'simple-placeholder', pcbThickness: t, verified: false },
        pins: labels.map((label, i) => ({ id: `P${i + 1}`, label, side: 'top', index: i,
          localPosition: [(i - (labels.length - 1) / 2) * Math.min(2.54, w / labels.length), h / 2 - 1, t / 2], exitDirection: [0, 0, 1] })) };
    } else {
      const def = prepared.find(p => p.id === partRef);
      if (!def) throw new Error(`Unknown part "${partRef}" for ${name}`);
      if (!assets[def.id]) assets[def.id] = await toBase64(`${BASE}/${PARTS_DIR}/${def.glb}`);
      component = { id, modelId: `custom:${def.id}`, name, rotation: [0, 0, place.rot], dimensions: def.dimensions,
        geometry: { kind: 'model', quality: 'detailed', modelFormat: 'glb', modelAssetId: def.id, modelCenter: def.modelCenter,
          modelOrientation: def.modelOrientation, origin: [0, 0, 0], calibrated: true, sourceFilename: def.source },
        pins: def.pins.map((p, i) => {
          const known = devkitLabels[p.id];  // terminal n of the adapter = DevKitC-1 header pin n
          const label = known?.label ?? p.label;
          return { ...p, label, side: p.localPosition[0] < 0 ? 'left' : 'right', index: i,
            aliases: known ? [p.id, ...(label === '5V' ? ['5V0'] : [])] : [] };
        }) };
    }
    component.position = [place.at[0], place.at[1], component.dimensions[2] / 2];
    components[name] = component;
  }

  // --- Pin references: "<part name> <pin>", pin by id, label or alias; "(...)" is a comment.
  const names = Object.keys(components).sort((a, b) => b.length - a.length);
  const resolve = ref => {
    const clean = ref.replace(/\(.*?\)/g, '').trim();
    const name = names.find(n => clean === n || clean.startsWith(n + ' '));
    if (!name) throw new Error(`Unknown part in "${ref}"`);
    const pinName = clean.slice(name.length).trim().toLowerCase();
    const part = components[name];
    const byId = part.pins.filter(p => p.id.toLowerCase() === pinName);
    const matches = byId.length ? byId : part.pins.filter(p => [p.label, ...(p.aliases ?? [])].some(v => v?.toLowerCase() === pinName));
    if (matches.length !== 1) throw new Error(`${matches.length ? 'Ambiguous' : 'Unknown'} pin "${pinName}" on ${name} (${ref})`);
    return { componentId: part.id, pinId: matches[0].id, text: `${name} ${matches[0].label}` };
  };
  const colors = { black: '#22251C', red: '#BF3128', orange: '#CC6511', blue: '#2B60AE', purple: '#7944AC',
    green: '#2A8450', brown: '#86572A', yellow: '#A87D00', white: '#E8E8E2' };
  const wires = [];
  for (const row of wiresTable.rows) {
    const from = resolve(pick(row, 'from', 'source'));
    for (const target of pick(row, 'to', 'destination').split(',').map(s => s.trim()).filter(Boolean)) {
      const to = resolve(target), colorName = pick(row, 'wire', 'color', 'colour').toLowerCase();
      wires.push({ id: `wire-${wires.length + 1}`, from: { componentId: from.componentId, pinId: from.pinId },
        to: { componentId: to.componentId, pinId: to.pinId }, color: colors[colorName] ?? colorName, diameter: 1.1,
        label: `${from.text} → ${to.text}`, curvature: 19 });
    }
  }
  const raw = { schemaVersion: 1, name: 'Reference project — real wiring', components: Object.values(components), wires,
    wireOrder: wires.map(w => w.id), camera: { position: [0, -260, 220], target: [0, 0, 0] }, assets };
  window.__spikeProject = JSON.stringify({ ...raw, assets: Object.fromEntries(Object.keys(assets).map(k => [k, `<${assets[k].length} base64 chars>`])) }, null, 1);

  const project = await importLegacy(raw);
  useEditor.getState().loadProject(project);
  const state = window.__spikeExport = { stage: 'loading', progress: null, error: null, result: null, startedAt: Date.now() };
  if (window.__spikePreviewOnly) { state.stage = 'loaded'; return { loaded: true, components: project.components.length, wires: project.wires.length }; }
  (async () => {
    try {
      await new Promise(r => setTimeout(r, 5000));
      state.stage = 'exporting';
      const t0 = performance.now();
      const result = await exportCinematic(useEditor.getState().project, defaultVideoSettings, [], p => { state.progress = p; });
      const bytes = new Uint8Array(await result.blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      state.base64 = btoa(binary);
      state.result = { frames: result.frames, renderSeconds: result.renderSeconds, totalSeconds: (performance.now() - t0) / 1000,
        bytes: bytes.length, duration: result.sequence.duration, shots: result.sequence.shots.length, warnings: result.sequence.warnings };
      state.stage = 'done';
    } catch (e) { state.error = String(e?.stack || e); state.stage = 'error'; }
  })();
  return { started: true, components: project.components.length, wires: project.wires.length };
}
