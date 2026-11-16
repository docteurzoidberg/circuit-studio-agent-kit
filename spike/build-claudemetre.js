async () => {
  // Spike test B: build a Circuit Studio project from the reference project's wire table
  // (parts by name, pins by human label), load it through the Open path, then start an Auto Video export.
  const { useEditor } = await import('/src/store.ts');
  const { importLegacy } = await import('/src/projectFiles.ts');
  const { exportCinematic } = await import('/src/videoExport.ts');
  const { defaultVideoSettings } = await import('/src/cinematic.ts');
  const { DEVKIT_COMPONENT } = await import('/src/model.ts');

  // Procedural stand-in for a part missing from the catalog: a box with labelled contacts on one edge.
  const box = (id, name, [w, h, t], color, labels, edge = 'top') => ({
    id, modelId: 'generic-pcb', name, position: [0, 0, 0], rotation: [0, 0, 0], dimensions: [w, h, t],
    geometry: { kind: 'procedural-pcb', quality: 'simple-placeholder', pcbColor: color, pcbThickness: t, verified: false },
    pins: labels.map((label, i) => {
      const offset = (i - (labels.length - 1) / 2) * 2.54;
      const pos = edge === 'top' ? [offset, h / 2 - 1.5, t / 2] : [-w / 2 + 1.5, offset, t / 2];
      return { id: `P${i + 1}`, label, side: edge === 'top' ? 'top' : 'left', index: i, localPosition: pos, exitDirection: [0, 0, 1] };
    }),
  });
  const place = (c, position) => ({ ...c, position });

  const parts = {
    mcu: place({ ...DEVKIT_COMPONENT, id: 'mcu', name: 'ESP32-S3-DevKitC-1' }, [0, 0, 0]),
    gaugeSession: place(box('gauge-session', 'SO-45 gauge (session)', [45, 45, 20], '#2b2f36', ['+', '-'], 'left'), [-75, 30, 0]),
    gaugeWeek: place(box('gauge-week', 'SO-45 gauge (week)', [45, 45, 20], '#2b2f36', ['+', '-'], 'left'), [-75, -30, 0]),
    display: place(box('display', 'TM1637 4-digit display', [50, 19, 8], '#1d4f8c', ['CLK', 'DIO', 'VCC', 'GND']), [70, 30, 0]),
    strip: place(box('strip', 'WS2812B strip (4 LEDs)', [28, 10, 2], '#f2f2ee', ['+5V', 'DIN', 'GND']), [70, -15, 0]),
    diode: place(box('diode', '1N400x diode', [10, 4, 4], '#202020', ['A', 'K']), [40, -45, 0]),
  };
  const byName = { Board: parts.mcu, 'Session gauge': parts.gaugeSession, 'Week gauge': parts.gaugeWeek, Display: parts.display, Strip: parts.strip, D1: parts.diode };

  // Wire table as written in the reference project's wiring page: color, from, to (pins by label).
  const table = [
    ['#2B60AE', 'Board GPIO4', 'Session gauge +'],
    ['#7944AC', 'Board GPIO5', 'Week gauge +'],
    ['#2A8450', 'Board GPIO6', 'Display CLK'],
    ['#86572A', 'Board GPIO7', 'Display DIO'],
    ['#CC6511', 'Board 3V3', 'Display VCC'],
    ['#A87D00', 'Board GPIO14', 'Strip DIN'],
    ['#BF3128', 'Board 5V', 'D1 A'],
    ['#BF3128', 'D1 K', 'Strip +5V'],
    ['#22251C', 'Board GND', 'Session gauge -'],
    ['#22251C', 'Board GND', 'Week gauge -'],
    ['#22251C', 'Board GND', 'Display GND'],
    ['#22251C', 'Board GND', 'Strip GND'],
  ];
  const resolve = ref => {
    const name = Object.keys(byName).sort((a, b) => b.length - a.length).find(n => ref.startsWith(n + ' '));
    if (!name) throw new Error(`Unknown part in "${ref}"`);
    const pinName = ref.slice(name.length + 1).toLowerCase();
    const part = byName[name];
    const pin = part.pins.find(p => [p.id, p.label, p.silkscreen, ...(p.aliases ?? [])].filter(Boolean).some(v => v.toLowerCase() === pinName));
    if (!pin) throw new Error(`Unknown pin "${pinName}" on ${name}`);
    return { componentId: part.id, pinId: pin.id, label: `${name} ${pin.label}` };
  };
  const wires = table.map(([color, from, to], i) => {
    const a = resolve(from), b = resolve(to);
    return { id: `wire-${i + 1}`, from: { componentId: a.componentId, pinId: a.pinId }, to: { componentId: b.componentId, pinId: b.pinId },
      color, diameter: 1.1, label: `${a.label} → ${b.label}`, curvature: 19 };
  });
  const raw = { schemaVersion: 1, name: 'Reference project wiring (spike)', components: Object.values(parts), wires,
    wireOrder: wires.map(w => w.id), camera: { position: [0, -220, 180], target: [0, 0, 0] } };
  window.__spikeProject = JSON.stringify(raw, null, 1);

  const project = await importLegacy(raw);
  useEditor.getState().loadProject(project);
  const state = window.__spikeExport = { stage: 'loading', progress: null, error: null, result: null, startedAt: Date.now() };
  (async () => {
    try {
      await new Promise(r => setTimeout(r, 3000));
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
