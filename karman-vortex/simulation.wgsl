struct Params {
    nx: u32, ny: u32, cells: u32, view: u32,
    cx: f32, cy: f32, radius: f32, u0: f32,
    omega_plus: f32, omega_minus: f32, steps: f32, dt: f32,
    trails: f32, aspect: f32, frame: f32, padding: f32,
    camera: vec4f,
}
struct Particle { points: array<vec2f, 8>, age: f32, seed: f32 }
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read> source: array<f32>;
@group(0) @binding(2) var<storage, read_write> destination: array<f32>;
@group(0) @binding(3) var<storage, read_write> field: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> particles: array<Particle>;

const c = array<vec2i, 9>(vec2i(0,0), vec2i(1,0), vec2i(0,1), vec2i(-1,0), vec2i(0,-1), vec2i(1,1), vec2i(-1,1), vec2i(-1,-1), vec2i(1,-1));
const w = array<f32, 9>(4.0/9.0, 1.0/9.0, 1.0/9.0, 1.0/9.0, 1.0/9.0, 1.0/36.0, 1.0/36.0, 1.0/36.0, 1.0/36.0);
const opposite = array<u32, 9>(0,3,4,1,2,7,8,5,6);
const reflect_y = array<u32, 9>(0,1,4,3,2,8,7,6,5);

fn solid(x: vec2f) -> bool { return distance(x, vec2f(p.cx,p.cy)) <= p.radius; }
fn equilibrium(q: u32, rho: f32, u: vec2f) -> f32 {
    let cu = dot(vec2f(c[q]),u);
    return w[q]*rho*(1.0+3.0*cu+4.5*cu*cu-1.5*dot(u,u));
}

@compute @workgroup_size(16, 16)
fn initialize(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= p.nx || id.y >= p.ny) { return; }
    let i = id.y*p.nx+id.x;
    let pos = vec2f(id.xy);
    let d = (pos-vec2f(p.cx+2.0*p.radius,p.cy))/(2.0*p.radius);
    // A small, one-time asymmetric initial disturbance seeds the wake instability.
    var u = vec2f(p.u0, 0.012*p.u0*exp(-dot(d,d)));
    if (solid(pos)) { u = vec2f(0); }
    for (var q=0u; q<9u; q++) { destination[q*p.cells+i] = equilibrium(q,1.0,u); }
    field[i] = vec4f(u,1,select(0.0,1.0,solid(pos)));
}

@compute @workgroup_size(16, 16)
fn collide_stream(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= p.nx || id.y >= p.ny) { return; }
    let pos = vec2i(id.xy);
    let i = id.y*p.nx+id.x;
    if (solid(vec2f(pos))) {
        for (var q=0u; q<9u; q++) { destination[q*p.cells+i] = w[q]; }
        return;
    }
    var f: array<f32,9>;
    // Pull streaming; stationary half-way bounce-back on links hitting the cylinder.
    for (var q=0u; q<9u; q++) {
        let neighbor = pos-c[q];
        if (solid(vec2f(neighbor))) {
            f[q] = source[opposite[q]*p.cells+i];
        } else if (neighbor.y < 0 || neighbor.y >= i32(p.ny)) {
            let x = u32(clamp(neighbor.x,0,i32(p.nx)-1));
            let y = u32(clamp(neighbor.y,0,i32(p.ny)-1));
            f[q] = source[reflect_y[q]*p.cells+y*p.nx+x];
        } else {
            let x = clamp(neighbor.x,0,i32(p.nx)-1);
            f[q] = source[q*p.cells+u32(neighbor.y)*p.nx+u32(x)];
        }
    }
    // Zou/He velocity inlet, u_y = 0. Unknown east-going populations are reconstructed.
    if (id.x == 0u) {
        let rho = (f[0]+f[2]+f[4]+2.0*(f[3]+f[6]+f[7]))/(1.0-p.u0);
        f[1] = f[3]+(2.0/3.0)*rho*p.u0;
        f[5] = f[7]+0.5*(f[4]-f[2])+rho*p.u0/6.0;
        f[8] = f[6]+0.5*(f[2]-f[4])+rho*p.u0/6.0;
    }
    var rho = 0.0;
    var momentum = vec2f(0);
    for (var q=0u; q<9u; q++) { rho += f[q]; momentum += f[q]*vec2f(c[q]); }
    let u = momentum/rho;
    var eq: array<f32,9>;
    for (var q=0u; q<9u; q++) { eq[q] = equilibrium(q,rho,u); }
    // TRT: even modes set viscosity; odd modes use Lambda = 3/16.
    // An outlet-only sponge attenuates outgoing fluctuations over the last 2D.
    let sponge = 0.035*pow(smoothstep(f32(p.nx)-4.0*p.radius,f32(p.nx-1u),f32(id.x)),2.0);
    for (var q=0u; q<9u; q++) {
        let o = opposite[q];
        let even = 0.5*((f[q]+f[o])-(eq[q]+eq[o]));
        let odd = 0.5*((f[q]-f[o])-(eq[q]-eq[o]));
        let result = f[q]-p.omega_plus*even-p.omega_minus*odd;
        destination[q*p.cells+i] = mix(result,equilibrium(q,1.0,vec2f(p.u0,0)),sponge);
    }
}

@compute @workgroup_size(16, 16)
fn extract_field(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= p.nx || id.y >= p.ny) { return; }
    let i = id.y*p.nx+id.x;
    var rho = 0.0;
    var momentum = vec2f(0);
    for (var q=0u; q<9u; q++) {
        let f = source[q*p.cells+i]; rho += f; momentum += f*vec2f(c[q]);
    }
    let mask = select(0.0,1.0,solid(vec2f(id.xy)));
    field[i] = vec4f(momentum/rho*(1.0-mask),rho,mask);
}

fn sample_velocity(pos: vec2f) -> vec2f {
    let z = clamp(pos,vec2f(0),vec2f(f32(p.nx)-1.001,f32(p.ny)-1.001));
    let cell = vec2u(z); let a = fract(z); let i = cell.y*p.nx+cell.x;
    return mix(mix(field[i].xy,field[i+1u].xy,a.x),mix(field[i+p.nx].xy,field[i+p.nx+1u].xy,a.x),a.y);
}
fn random(v: f32) -> f32 { return fract(sin(v*127.1+311.7)*43758.5453); }
fn spawn(i: u32, seed: f32) -> Particle {
    let s = f32(i)*1.37+seed;
    var pos = vec2f(random(s)*f32(p.nx),random(s+31.7)*f32(p.ny));
    // Half the tracers resolve the central wake; the rest show the surrounding stream.
    if ((i&1u)==0u) { pos.y = p.cy+(random(s+5.3)-0.5)*7.0*p.radius; }
    if (solid(pos)) { pos.x = p.cx-1.2*p.radius; }
    var part: Particle;
    for (var j=0u; j<8u; j++) { part.points[j] = pos; }
    part.age = 1500.0+4500.0*random(s+11.0); part.seed = seed+1.0;
    return part;
}
@compute @workgroup_size(128)
fn initialize_particles(@builtin(global_invocation_id) id: vec3u) {
    if (id.x < arrayLength(&particles)) { particles[id.x] = spawn(id.x,0); }
}
@compute @workgroup_size(128)
fn advect_particles(@builtin(global_invocation_id) id: vec3u) {
    let i = id.x; if (i >= arrayLength(&particles)) { return; }
    var part = particles[i];
    let old = part.points[0];
    let mid = old+0.5*p.dt*sample_velocity(old);
    let next = old+p.dt*sample_velocity(mid);
    if (part.age <= 0.0 || next.x < 1 || next.x >= f32(p.nx)-2 || next.y < 1 || next.y >= f32(p.ny)-2 || solid(next)) {
        particles[i] = spawn(i,part.seed); return;
    }
    for (var j=7u; j>0u; j--) { part.points[j] = part.points[j-1u]; }
    part.points[0] = next; part.age -= p.dt;
    particles[i] = part;
}

@compute @workgroup_size(128)
fn rescale_particles(@builtin(global_invocation_id) id: vec3u) {
    let i = id.x; if (i >= arrayLength(&particles)) { return; }
    for (var j=0u; j<8u; j++) { particles[i].points[j] *= p.padding; }
    particles[i].age *= p.padding;
}
