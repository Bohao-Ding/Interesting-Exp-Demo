import {Flow, createKernels} from './flow.js';
const $ = id => document.getElementById(id), canvas = $('canvas');
const camera = {x: 0.5, y: 0.5, zoom: 1};
let device, kernels, context, renderPipeline, flow, renderGroup;
let view = 0, arrows = false, paused = false, looping = true, busy = true, running = true;
let frameWork = Promise.resolve(), remeshTimer, screenshot = false, checks;
let lastWall = 0, budget = 0, lastStats = performance.now(), statSteps = 0, statFrames = 0;
const verify = new URLSearchParams(location.search).has('verify');

function fail(error) {
    running = false; $('loading').classList.remove('hidden'); $('loading-title').textContent = '求解已停止';
    $('loading-text').textContent = error.message || String(error); $('progress').hidden = true;
    $('status').textContent = 'GPU 求解错误'; console.error(error);
}
function resize() {
    const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 2);
    const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
function updateParams() { flow.write(view, arrows, camera, canvas.width / canvas.height); }
function bindRender() {
    renderGroup = device.createBindGroup({layout: renderPipeline.getBindGroupLayout(0), entries: [
        {binding: 0, resource: {buffer: flow.params}}, {binding: 1, resource: {buffer: flow.field}}]});
    $('cells').textContent = flow.cells.toLocaleString('en-US');
    $('re-value').innerHTML = `${flow.reynolds}<small>Re</small>`;
    $('plot-info').textContent = `${flow.nx} × ${flow.ny}  /  Δx = H/${flow.ny}`;
    lastStats = performance.now(); statSteps = flow.steps; statFrames = 0;
}
function draw(encoder) {
    const pass = encoder.beginRenderPass({colorAttachments: [{view: context.getCurrentTexture().createView(),
        clearValue: {r: 0.02, g: 0.04, b: 0.06, a: 1}, loadOp: 'clear', storeOp: 'store'}]});
    pass.setPipeline(renderPipeline); pass.setBindGroup(0, renderGroup); pass.draw(3); pass.end();
}
async function save(path, blob) {
    const response = await fetch(`/save/${path}`, {method: 'POST', body: blob});
    if (!response.ok) throw Error('本地文件保存失败');
}
async function inspect() {
    const {inspectField} = await import('./verification.js');
    const report = {analyticChecks: checks, field: await inspectField(flow)};
    $('verification').textContent = JSON.stringify(report, null, 2);
    await save('validation.json', new Blob([JSON.stringify(report, null, 2)], {type: 'application/json'}));
}
function desiredMesh() {
    return $('quality').value === 'auto' ? (camera.zoom > 3.2 ? 2560 : camera.zoom > 1.6 ? 2048 : 1536) : Number($('quality').value);
}
function queueRemesh() {
    clearTimeout(remeshTimer); remeshTimer = setTimeout(() => {
        if (!busy && running && flow && desiredMesh() !== flow.nx) remesh(desiredMesh()).catch(fail);
    }, 350);
}
async function remesh(width) {
    busy = true; $('reset').disabled = true; $('status').textContent = '重映射网格…';
    await frameWork; flow = await flow.refine(width); bindRender();
    if (verify) await inspect();
    lastWall = performance.now(); budget = 0; busy = false; $('reset').disabled = false;
    $('status').textContent = paused ? '已暂停' : 'GPU 实时演化'; queueRemesh();
}
async function reset(warmup = 0) {
    busy = true; $('reset').disabled = true; $('quality').disabled = true; $('re').disabled = true;
    await frameWork; await device.queue.onSubmittedWorkDone(); flow?.destroy();
    const width = desiredMesh(); flow = new Flow(device, kernels, width, width / 2, Number($('re').value));
    resize(); updateParams(); bindRender(); flow.initialize();
    $('loading').classList.remove('hidden'); $('loading-title').textContent = '让剪切层自然卷起';
    $('status').textContent = '初始化剪切层'; $('progress').value = 0;
    while (flow.time < warmup && running) {
        updateParams(); const encoder = device.createCommandEncoder(); flow.advance(encoder, 128); draw(encoder);
        device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
        $('progress').value = flow.time / warmup;
        $('loading-text').textContent = `真实预演化 ${Math.min(100, Math.round(flow.time / warmup * 100))}% · tU/H = ${flow.time.toFixed(2)}`;
    }
    if (verify) await inspect();
    $('loading').classList.add('hidden'); $('reset').disabled = false; $('quality').disabled = false; $('re').disabled = false;
    lastWall = performance.now(); budget = 0; lastStats = performance.now(); statSteps = flow.steps; statFrames = 0;
    busy = false; $('status').textContent = paused ? '已暂停' : 'GPU 实时演化'; queueRemesh();
}
function capture() {
    const out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height;
    const c = out.getContext('2d'); c.drawImage(canvas, 0, 0); const s = out.width / 1400;
    c.font = `${15 * s}px Segoe UI`; c.fillStyle = '#ecf7f5'; c.shadowColor = '#000'; c.shadowBlur = 5;
    c.fillText(`KELVIN–HELMHOLTZ  /  ${['TRACER', 'VORTICITY', 'SPEED'][view]}`, 23 * s, 30 * s);
    c.font = `${12 * s}px Consolas`;
    c.fillText(`${flow.nx} × ${flow.ny}  ·  Re ${flow.reynolds}  ·  tU/H ${flow.time.toFixed(3)}  ·  ${camera.zoom.toFixed(1)}x`, 23 * s, out.height - 19 * s);
    out.toBlob(blob => save('preview.png', blob).then(() => {
        $('snapshot').textContent = '已保存'; setTimeout(() => { $('snapshot').textContent = '截图'; }, 1600);
    }).catch(console.error));
}
async function renderFrame(now) {
    const elapsed = Math.min(0.05, Math.max(0, (now - lastWall) / 1000)); lastWall = now;
    resize(); updateParams();
    if (!paused) budget = Math.min(64, budget + elapsed * 0.16 * Number($('speed').value) * flow.ny / flow.u0);
    else budget = 0;
    const count = Math.min(32, 4 * Math.floor(budget / 4)); budget -= count;
    const encoder = device.createCommandEncoder(); if (count) flow.advance(encoder, count); draw(encoder);
    device.queue.submit([encoder.finish()]); if (screenshot) { capture(); screenshot = false; }
    await device.queue.onSubmittedWorkDone(); statFrames++;
    const dt = (performance.now() - lastStats) / 1000;
    $('timeline').value = flow.time;
    if (dt > 0.8) {
        $('time').textContent = flow.time.toFixed(2); $('fps').textContent = (statFrames / dt).toFixed(0);
        $('throughput').textContent = `${((flow.steps - statSteps) * flow.cells / dt / 1e6).toFixed(0)} MLUPS`;
        lastStats = performance.now(); statSteps = flow.steps; statFrames = 0;
    }
}
async function tick(now) {
    if (!running) return;
    if (!busy) {
        frameWork = renderFrame(now); await frameWork;
        if (looping && flow.time >= 6) await reset(0.4);
    }
    requestAnimationFrame(time => tick(time).catch(fail));
}
function fit() {
    const a = canvas.clientWidth / canvas.clientHeight; return {x: Math.max(a / 2, 1), y: Math.max(2 / a, 1)};
}
function constrain() {
    const f = fit(); for (const key of ['x', 'y']) {
        const half = Math.min(0.5, f[key] / (2 * camera.zoom)); camera[key] = Math.max(half, Math.min(1 - half, camera[key]));
    }
}
function zoom(factor, x = 0.5, y = 0.5) {
    const next = Math.max(1, Math.min(20, camera.zoom * factor)), f = fit();
    camera.x += (x - 0.5) * f.x * (1 / camera.zoom - 1 / next);
    camera.y += (0.5 - y) * f.y * (1 / camera.zoom - 1 / next);
    camera.zoom = next; constrain(); $('zoom-level').textContent = `${next.toFixed(1)}×`; queueRemesh();
}
function fitView() { camera.x = camera.y = 0.5; camera.zoom = 1; $('zoom-level').textContent = '1.0×'; queueRemesh(); }
canvas.addEventListener('wheel', event => {
    event.preventDefault(); const r = canvas.getBoundingClientRect();
    zoom(Math.exp(-event.deltaY * 0.0015), (event.clientX - r.left) / r.width, (event.clientY - r.top) / r.height);
}, {passive: false});
let drag;
canvas.addEventListener('pointerdown', event => {
    drag = {x: event.clientX, y: event.clientY}; canvas.focus({preventScroll: true}); canvas.setPointerCapture(event.pointerId); canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', event => {
    if (!drag) return; const r = canvas.getBoundingClientRect(), f = fit();
    camera.x -= (event.clientX - drag.x) / r.width * f.x / camera.zoom;
    camera.y += (event.clientY - drag.y) / r.height * f.y / camera.zoom;
    drag = {x: event.clientX, y: event.clientY}; constrain();
});
for (const name of ['pointerup', 'pointercancel']) canvas.addEventListener(name, () => { drag = undefined; canvas.classList.remove('dragging'); });
canvas.addEventListener('dblclick', fitView);
$('zoom-in').onclick = () => zoom(1.5); $('zoom-out').onclick = () => zoom(1 / 1.5); $('fit').onclick = fitView;
$('quality').onchange = queueRemesh; $('reset').onclick = () => { if (!busy) reset().catch(fail); };
function setView(next) {
    view = next;
    for (const b of $('views').querySelectorAll('[data-view]')) b.classList.toggle('active', Number(b.dataset.view) === view);
    $('plot-title').textContent = ['示踪物 / TWO-COLOUR MIXING', '涡量 / VORTICITY', '流速 / SPEED'][view];
    $('legend-name').textContent = ['示踪物浓度 c', 'ω H / U', '|u| / U'][view];
    $('legend-labels').innerHTML = ['<span>0</span><span>0.5</span><span>1</span>', '<span>−35</span><span>0</span><span>+35</span>', '<span>0</span><span>0.7</span><span>1.4</span>'][view];
    $('legend-bar').style.background = ['linear-gradient(90deg,#095469,#66765e,#b45225)', 'linear-gradient(90deg,#13a3e5,#06131c,#ff5933)', 'linear-gradient(90deg,#041020,#0aa8b2,#90c980,#ffb332,#ed3039)'][view];
}
$('views').onclick = event => { if (event.target.dataset.view) setView(Number(event.target.dataset.view)); };
$('arrows').onclick = () => { arrows = !arrows; $('arrows').classList.toggle('active', arrows); $('arrows').setAttribute('aria-pressed', arrows); };
function pause() { paused = !paused; $('pause').textContent = paused ? '继续' : '暂停'; $('status').textContent = paused ? '已暂停' : 'GPU 实时演化'; }
$('pause').onclick = pause;
$('loop').onclick = () => { looping = !looping; $('loop').classList.toggle('active', looping); $('loop').setAttribute('aria-pressed', looping); };
$('snapshot').onclick = () => { screenshot = true; };
async function fullscreen() { if (document.fullscreenElement) await document.exitFullscreen(); else await $('viewport').requestFullscreen(); }
$('fullscreen').onclick = () => fullscreen().catch(console.error);
document.addEventListener('keydown', event => {
    if (['INPUT', 'SELECT', 'BUTTON'].includes(event.target.tagName)) return;
    const directions = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1]};
    if (directions[event.code]) {
        event.preventDefault(); const [x, y] = directions[event.code], f = fit();
        camera.x += x * f.x * 0.16 / camera.zoom; camera.y += y * f.y * 0.16 / camera.zoom; constrain();
    }
    if (event.code === 'Home') { event.preventDefault(); fitView(); }
    if (event.code === 'Space') { event.preventDefault(); pause(); }
    if (event.code === 'KeyF') fullscreen().catch(console.error);
});

async function start() {
    if (!navigator.gpu) throw Error('需要支持 WebGPU 并启用硬件加速的浏览器，请通过本机 HTTP 地址打开。');
    const adapter = await navigator.gpu.requestAdapter({powerPreference: 'high-performance'});
    if (!adapter) throw Error('没有可用的 WebGPU 适配器。');
    device = await adapter.requestDevice(); device.lost.then(info => fail(Error(info.message)));
    device.addEventListener('uncapturederror', event => fail(event.error));
    $('gpu-name').textContent = `${adapter.info.vendor} ${adapter.info.architecture}`;
    context = canvas.getContext('webgpu'); const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({device, format, alphaMode: 'opaque'}); kernels = await createKernels(device);
    const module = device.createShaderModule({code: await (await fetch('render.wgsl')).text()});
    const info = await module.getCompilationInfo(), errors = info.messages.filter(item => item.type === 'error');
    if (errors.length) throw Error(errors.map(item => `行 ${item.lineNum}: ${item.message}`).join('\n'));
    renderPipeline = await device.createRenderPipelineAsync({layout: 'auto', vertex: {module, entryPoint: 'fullscreen'},
        fragment: {module, entryPoint: 'flow', targets: [{format}]}});
    if (verify) {
        $('loading-text').textContent = '进行小网格解析解核对：黏性剪切波与示踪物对流扩散…';
        const {analyticChecks} = await import('./verification.js'); checks = await analyticChecks(device, kernels);
    }
    await reset(1); requestAnimationFrame(time => tick(time).catch(fail));
}
start().catch(fail);
