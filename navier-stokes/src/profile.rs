//! Finite radial Taylor reconstruction of paper equations (4.7), (4.13), (B.1), (B.3).
//! The global oscillatory corrections and smooth forcing construction are NOT implemented.
use std::f64::consts::PI;

pub const H: f64 = 0.005;
pub const A: f64 = 0.5 + H;
pub const D: f64 = 0.5 - H;
pub const ETA_MAX: f64 = 0.90;
pub const X_MAX: f64 = 0.08;
pub const Z_HALF: f64 = 0.40;
pub const CHANNEL_HALF: f64 = 0.95;
pub const ORDER: usize = 14;
const J: f64 = 0.02;
const SIGMA: f64 = 0.30;
const LAMBDA: f64 = 8.0;
const PRESSURE_SCALE: f64 = 2.0;
const ROWS: usize = 513;

pub struct Paths {
    pub lines: Vec<f32>,
    pub dots: Vec<f32>,
    pub phases: [Vec<f32>; 2],
    pub omega: [f64; 2],
    pub momentum: [f64; 2],
    pub radius_ratio: [f64; 2],
}

// Invert z/sqrt(tau) with equal physical scales on all three axes.
fn eta_from_scaled_z(z: f64, s: f64) -> f64 {
    let target = z * (-H * s).exp();
    let mut eta = target.clamp(-0.85, 0.85);
    for _ in 0..10 {
        let d = 1.0 - eta * eta;
        let f = eta / d.powf(D) - target;
        eta -= f / (d.powf(-D) * (1.0 + 2.0 * D * eta * eta / d));
    }
    eta
}

#[derive(Clone)]
struct Jet(Vec<f64>);
impl Jet {
    fn constant(x: f64, n: usize) -> Self {
        let mut v = vec![0.0; n];
        v[0] = x;
        Self(v)
    }
    fn variable(x: f64, n: usize) -> Self {
        let mut a = Self::constant(x, n);
        a.0[1] = 1.0;
        a
    }
    fn add(&self, b: &Self) -> Self {
        Self(self.0.iter().zip(&b.0).map(|(x, y)| x + y).collect())
    }
    fn scale(&self, b: f64) -> Self {
        Self(self.0.iter().map(|x| x * b).collect())
    }
    fn sub(&self, b: &Self) -> Self {
        self.add(&b.scale(-1.0))
    }
    fn mul(&self, b: &Self) -> Self {
        let n = self.0.len();
        let mut v = vec![0.0; n];
        for k in 0..n {
            for i in 0..=k {
                v[k] += self.0[i] * b.0[k - i];
            }
        }
        Self(v)
    }
    fn inv(&self) -> Self {
        let n = self.0.len();
        let mut v = vec![0.0; n];
        v[0] = 1.0 / self.0[0];
        for k in 1..n {
            let mut sum = 0.0;
            for i in 1..=k {
                sum += self.0[i] * v[k - i];
            }
            v[k] = -sum / self.0[0];
        }
        Self(v)
    }
    fn derivative(&self) -> Self {
        let n = self.0.len();
        let mut v = vec![0.0; n];
        for k in 0..n - 1 {
            v[k] = (k + 1) as f64 * self.0[k + 1];
        }
        Self(v)
    }
    fn exp(&self) -> Self {
        let n = self.0.len();
        let mut v = vec![0.0; n];
        v[0] = self.0[0].exp();
        for k in 1..n {
            let mut sum = 0.0;
            for i in 1..=k {
                sum += i as f64 * self.0[i] * v[k - i];
            }
            v[k] = sum / k as f64;
        }
        Self(v)
    }
}

fn zeta(eta: f64) -> f64 {
    let l = 1.0 - 2.0 * H * eta * eta;
    let hc = D * eta + (1.0 - eta * eta) * (4.0 * eta + J);
    -l * hc / (hc * hc + SIGMA * SIGMA)
}
fn log_axis(eta: f64) -> f64 {
    // Fixed Simpson quadrature only fixes the value of the logarithm. Derivatives use jets.
    let n = 512;
    let dx = eta / n as f64;
    let mut sum = zeta(0.0) + zeta(eta);
    for i in 1..n {
        sum += if i % 2 == 0 {
            2.0 * zeta(i as f64 * dx)
        } else {
            4.0 * zeta(i as f64 * dx)
        };
    }
    LAMBDA * sum * dx / 3.0
}

#[derive(Clone)]
struct Row {
    values: Vec<[f64; 3]>,
    derivatives: Vec<[f64; 3]>,
}

fn row(eta: f64, order: usize, log_normalization: f64) -> Row {
    let m = order + 4;
    let e = Jet::variable(eta, m);
    let one = Jet::constant(1.0, m);
    let d = one.sub(&e.mul(&e));
    let l = one.sub(&e.mul(&e).scale(2.0 * H));
    let u0 = e.scale(4.0).add(&Jet::constant(J, m));
    let hc = e.scale(D).add(&d.mul(&u0));
    let ze = l
        .mul(&hc)
        .scale(-1.0)
        .mul(&hc.mul(&hc).add(&Jet::constant(SIGMA * SIGMA, m)).inv());
    let mut logf = Jet::constant(log_axis(eta) - log_normalization, m);
    for k in 1..m {
        logf.0[k] = LAMBDA * ze.0[k - 1] / k as f64;
    }
    let p0 = one.add(&e.mul(&e)).inv();
    let p0 = p0.mul(&p0).scale(-PRESSURE_SCALE * PRESSURE_SCALE);
    let mut f = vec![logf.exp()];
    let mut u = vec![u0];
    let mut p = vec![p0];
    let denominator = l.scale(2.0).inv();
    for n in 0..order {
        let mut ws = Vec::new();
        let mut hs = Vec::new();
        for i in 0..=n {
            let av = u[i].scale(1.0 / (i + 1) as f64);
            let wi = e.mul(&av).scale(-2.0 * D).sub(&d.mul(&av.derivative()));
            ws.push(if i == 0 { wi.add(&one) } else { wi });
            let hi = d.mul(&u[i]);
            hs.push(if i == 0 { hi.add(&e.scale(D)) } else { hi });
        }
        let mut rf = Jet::constant(0.0, m);
        let mut ru = Jet::constant(0.0, m);
        let mut pp = Jet::constant(0.0, m);
        for i in 0..=n {
            let j = n - i;
            rf = rf
                .add(&ws[i].mul(&f[j]).scale((j + 1) as f64))
                .sub(&e.mul(&u[i]).mul(&f[j]).scale(2.0 * H))
                .add(&hs[i].mul(&f[j].derivative()));
            ru = ru
                .add(&ws[i].mul(&u[j]).scale(j as f64))
                .sub(&e.mul(&u[i]).mul(&u[j]).scale(2.0 * A))
                .add(&hs[i].mul(&u[j].derivative()));
            pp = pp.add(&f[i].mul(&f[j]));
        }
        rf = rf.add(&f[n].scale(H));
        ru = ru
            .add(&u[n].scale(A))
            .add(&d.mul(&p[n].derivative()))
            .sub(&e.mul(&p[n]).scale(4.0 * A + 2.0 * n as f64));
        f.push(rf.mul(&denominator).scale(1.0 / ((n + 1) * (n + 2)) as f64));
        u.push(ru.mul(&denominator).scale(1.0 / ((n + 1) * (n + 1)) as f64));
        p.push(pp.scale(1.0 / (n + 1) as f64));
    }
    Row {
        values: (0..=order)
            .map(|k| [f[k].0[0], u[k].0[0], p[k].0[0]])
            .collect(),
        derivatives: (0..=order)
            .map(|k| [f[k].0[1], u[k].0[1], p[k].0[1]])
            .collect(),
    }
}

pub struct Profile {
    rows: Vec<Row>,
    log_normalization: f64,
}
#[derive(Clone, Copy)]
pub struct Values {
    pub f: f64,
    pub u: f64,
    pub p: f64,
    pub v0: f64,
    pub fx: f64,
    pub fxx: f64,
    pub fe: f64,
    pub ux: f64,
    pub uxx: f64,
    pub ue: f64,
    pub px: f64,
    pub pe: f64,
    pub average_u: f64,
    pub average_ue: f64,
}
impl Profile {
    pub fn new() -> Self {
        let max_log = (0..ROWS)
            .map(|i| log_axis(-ETA_MAX + 2.0 * ETA_MAX * i as f64 / (ROWS - 1) as f64))
            .fold(f64::NEG_INFINITY, f64::max);
        let log_normalization = max_log - (0.8_f64).ln();
        Self {
            rows: (0..ROWS)
                .map(|i| {
                    row(
                        -ETA_MAX + 2.0 * ETA_MAX * i as f64 / (ROWS - 1) as f64,
                        ORDER,
                        log_normalization,
                    )
                })
                .collect(),
            log_normalization,
        }
    }
    fn evaluate_row(r: &Row, x: f64, eta: f64, order: usize) -> Values {
        let mut v = [0.0; 3];
        let mut de = [0.0; 3];
        let mut dx = [0.0; 3];
        let mut dxx = [0.0; 3];
        let mut av = 0.0;
        let mut ave = 0.0;
        for k in (0..=order).rev() {
            for c in 0..3 {
                dxx[c] = dxx[c] * x + 2.0 * dx[c];
                dx[c] = dx[c] * x + v[c];
                v[c] = v[c] * x + r.values[k][c];
                de[c] = de[c] * x + r.derivatives[k][c];
            }
            av = av * x + r.values[k][1] / (k + 1) as f64;
            ave = ave * x + r.derivatives[k][1] / (k + 1) as f64;
        }
        Values {
            f: v[0],
            u: v[1],
            p: v[2],
            v0: (2.0 * eta * v[1] - 2.0 * D * eta * av - (1.0 - eta * eta) * ave)
                / (1.0 - 2.0 * H * eta * eta),
            fx: dx[0],
            fxx: dxx[0],
            fe: de[0],
            ux: dx[1],
            uxx: dxx[1],
            ue: de[1],
            px: dx[2],
            pe: de[2],
            average_u: av,
            average_ue: ave,
        }
    }
    pub fn eval(&self, x: f64, eta: f64) -> Values {
        let step = 2.0 * ETA_MAX / (ROWS - 1) as f64;
        let t = ((eta + ETA_MAX) / step).clamp(0.0, (ROWS - 1) as f64 - 1e-10);
        let i = t.floor() as usize;
        let s = t - i as f64;
        let h00 = 2.0 * s * s * s - 3.0 * s * s + 1.0;
        let h10 = s * s * s - 2.0 * s * s + s;
        let h01 = -2.0 * s * s * s + 3.0 * s * s;
        let h11 = s * s * s - s * s;
        let d00 = (6.0 * s * s - 6.0 * s) / step;
        let d10 = 3.0 * s * s - 4.0 * s + 1.0;
        let d01 = (-6.0 * s * s + 6.0 * s) / step;
        let d11 = 3.0 * s * s - 2.0 * s;
        let a = &self.rows[i];
        let b = &self.rows[i + 1];
        let mut r = Row {
            values: vec![[0.0; 3]; ORDER + 1],
            derivatives: vec![[0.0; 3]; ORDER + 1],
        };
        for k in 0..=ORDER {
            for c in 0..3 {
                r.values[k][c] = h00 * a.values[k][c]
                    + h10 * step * a.derivatives[k][c]
                    + h01 * b.values[k][c]
                    + h11 * step * b.derivatives[k][c];
                r.derivatives[k][c] = d00 * a.values[k][c]
                    + d10 * a.derivatives[k][c]
                    + d01 * b.values[k][c]
                    + d11 * b.derivatives[k][c];
            }
        }
        Self::evaluate_row(&r, x, eta, ORDER)
    }
    pub fn field(&self, point: [f64; 3], tau: f64) -> Option<([f64; 3], f64)> {
        let [x, y, z] = point;
        let mut q = tau + z.abs().powf(1.0 / D);
        for _ in 0..12 {
            let zz = z * z * q.powf(2.0 * H);
            let error = q - zz - tau;
            let next = q - error / (1.0 - 2.0 * H * zz / q);
            if (next - q).abs() < 1e-13 * q {
                q = next;
                break;
            }
            q = next.max(tau);
        }
        let eta = z / q.powf(D);
        let radial = (x * x + y * y) / (2.0 * q);
        if eta.abs() > ETA_MAX || radial > X_MAX {
            return None;
        }
        let v = self.eval(radial, eta);
        let spin = q.powf(-A - 0.5) * v.f;
        let vel = [
            v.v0 * x / (2.0 * q) - spin * y,
            v.v0 * y / (2.0 * q) + spin * x,
            q.powf(-A) * v.u,
        ];
        Some((vel, q.powf(-2.0 * A) * v.p))
    }
    pub fn verification(&self) -> String {
        let mut angular: f64 = 0.0;
        let mut axial: f64 = 0.0;
        let mut pressure: f64 = 0.0;
        let mut truncation: f64 = 0.0;
        for j in 0..19 {
            let eta = -0.8 + 1.6 * j as f64 / 18.0;
            let exact = row(eta, ORDER, self.log_normalization);
            for i in 0..9 {
                let x = X_MAX * i as f64 / 8.0;
                let v = Self::evaluate_row(&exact, x, eta, ORDER);
                let low = Self::evaluate_row(&exact, x, eta, ORDER - 4);
                let l = 1.0 - 2.0 * H * eta * eta;
                let d = 1.0 - eta * eta;
                let w = 1.0 - 2.0 * D * eta * v.average_u - d * v.average_ue;
                let hc = D * eta + d * v.u;
                let r1 = 2.0 * l * (x * v.fxx + 2.0 * v.fx)
                    - w * (v.f + x * v.fx)
                    - H * (1.0 - 2.0 * eta * v.u) * v.f
                    - hc * v.fe;
                let r2 = 2.0 * l * (x * v.uxx + v.ux)
                    - w * x * v.ux
                    - A * (1.0 - 2.0 * eta * v.u) * v.u
                    - hc * v.ue
                    - d * v.pe
                    + 4.0 * A * eta * v.p
                    + 2.0 * eta * x * v.px;
                angular = angular.max(r1.abs());
                axial = axial.max(r2.abs());
                pressure = pressure.max((v.px - v.f * v.f).abs());
                truncation = truncation
                    .max((v.f - low.f).abs())
                    .max((v.u - low.u).abs())
                    .max((v.p - low.p).abs());
            }
        }
        let mut divergence: f64 = 0.0;
        for tau in [1.0, 0.1, 0.001] {
            for eta in [-0.6, 0.0, 0.6] {
                let q = tau / (1.0 - eta * eta);
                let point = [(0.4 * X_MAX * q).sqrt(), 0.0, q.powf(D) * eta];
                let eps = 1e-5 * q.sqrt();
                let mut div = 0.0;
                let mut norm = 0.0;
                for c in 0..3 {
                    let mut plus = point;
                    let mut minus = point;
                    plus[c] += eps;
                    minus[c] -= eps;
                    let vp = self.field(plus, tau).unwrap().0[c];
                    let vm = self.field(minus, tau).unwrap().0[c];
                    let grad = (vp - vm) / (2.0 * eps);
                    div += grad;
                    norm += grad.abs();
                }
                divergence = divergence.max(div.abs() / norm.max(1e-30));
            }
        }
        format!("{{\"radial_order\":{ORDER},\"eta_rows\":{ROWS},\"x_max\":{X_MAX},\"h\":{H},\"lambda\":{LAMBDA},\"sigma\":{SIGMA},\"j0\":{J},\"pressure_scale\":{PRESSURE_SCALE},\"axis_pressure\":\"-4/(1+eta^2)^2: illustrative local datum, not the matched datum of Lemma A.5\",\"global_parameter_inequalities_certified\":false,\"angular_profile_residual\":{angular:e},\"axial_profile_residual\":{axial:e},\"radial_pressure_residual\":{pressure:e},\"order_14_vs_10_max_difference\":{truncation:e},\"cartesian_divergence_relative\":{divergence:e},\"scope\":\"local finite-order leading field; not the global smooth-forcing blowup solution\"}}")
    }
    pub fn geometry(&self, tau: f64) -> (Vec<f32>, f64, f64) {
        let mut data = Vec::new();
        let mut max_speed: f64 = 0.0;
        let zoom = tau.sqrt().recip();
        for j in 0..13 {
            let channel = j >= 9;
            for ring in 0..2 {
                for k in 0..8 {
                    let z_seed = if channel { [-0.32, -0.18, 0.18, 0.32][j - 9] }
                        else { -Z_HALF + 2.0 * Z_HALF * j as f64 / 8.0 };
                    let eta = eta_from_scaled_z(z_seed, -tau.ln());
                    let q = tau / (1.0 - eta * eta);
                    let fraction = if channel { 0.02 + 0.06 * ring as f64 } else { 0.45 + 0.4 * ring as f64 };
                    let rad = (2.0 * q * X_MAX * fraction).sqrt();
                    let theta = 2.0 * PI * k as f64 / 8.0 + 0.17 * j as f64;
                    let mut point = [rad * theta.cos(), rad * theta.sin(), q.powf(D) * eta];
                    for _ in 0..if channel { 400 } else { 96 } {
                        let Some((velocity, _)) = self.field(point, tau) else {
                            break;
                        };
                        let speed = (velocity.iter().map(|x| x * x).sum::<f64>()).sqrt();
                        if !speed.is_finite() || speed < 1e-12 {
                            break;
                        }
                        max_speed = max_speed.max(speed);
                        let ds = (0.012 * tau.sqrt()).min(0.2 * point[0].hypot(point[1]));
                        let mid =
                            std::array::from_fn(|c| point[c] + 0.5 * ds * velocity[c] / speed);
                        let Some((mv, _)) = self.field(mid, tau) else {
                            break;
                        };
                        let ms = mv.iter().map(|x| x * x).sum::<f64>().sqrt();
                        let next = std::array::from_fn(|c| point[c] + ds * mv[c] / ms);
                        if next[2].abs() * zoom > if channel { CHANNEL_HALF } else { Z_HALF } { break; }
                        let color = (speed * tau.powf(A) / 3.5).clamp(0.0, 1.0) as f32;
                        for v in [point, next] {
                            data.extend_from_slice(&[
                                (v[0] * zoom) as f32,
                                (v[1] * zoom) as f32,
                                (v[2] * zoom) as f32,
                                if channel { 2.0 + color } else { color },
                            ]);
                        }
                        point = next;
                    }
                }
            }
        }
        (data, max_speed, zoom)
    }

    /// Independently integrate upper/lower volume layers; rotated copies use axisymmetry.
    pub fn pathlines(&self, s: f64) -> Paths {
        self.integrate_pathlines(s, 0.01, 0.04)
    }
    fn integrate_pathlines(&self, s: f64, max_step: f64, angle_step: f64) -> Paths {
        let zoom = (0.5 * s).exp();
        let mut result = Paths {
            lines: Vec::new(), dots: Vec::new(), phases: [Vec::new(), Vec::new()],
            omega: [0.0; 2], momentum: [0.0; 2], radius_ratio: [1.0; 2],
        };
        let band = (s / 0.12).floor() as i32;
        for cohort in (band - 6).max(0)..=band {
            let born = cohort as f64 * 0.12;
            for ring in 0..2 {
                let radial = X_MAX * (0.4 + 0.4 * ring as f64);
                let mut lo = -0.02;
                let mut hi = 0.01;
                for _ in 0..32 {
                    let eta = 0.5 * (lo + hi);
                    let u = self.eval(radial, eta).u;
                    if D * eta + (1.0 - eta * eta) * u > 0.0 { hi = eta; }
                    else { lo = eta; }
                }
                let root = 0.5 * (lo + hi);
                let center = root / (1.0 - root * root).powf(D) * (H * born).exp();
                for (layer, offset) in [-0.22, -0.10, 0.10, 0.22].iter().enumerate() {
                    let side = if layer < 2 { 0 } else { 1 };
                    let sign = if side == 0 { -1.0 } else { 1.0 };
                    let eta = eta_from_scaled_z(center + offset, born);
                    let tau0 = (-born).exp();
                    let q = tau0 / (1.0 - eta * eta);
                    let radius = (2.0 * q * radial).sqrt();
                    let mut point = [radius, 0.0, q.powf(D) * eta];
                    let birth_momentum = radius * self.field(point, tau0).unwrap().0[1];
                    let mut at = born;
                    let mut canonical = Vec::new();
                    let mut xy = vec![1.0_f32, 0.0];
                    while at < s - 1e-10 {
                        let tau = (-at).exp();
                        let Some((v, _)) = self.field(point, tau) else { break; };
                        let r2 = point[0] * point[0] + point[1] * point[1];
                        let omega = (point[0] * v[1] - point[1] * v[0]) / r2.max(1e-300);
                        let ds = (s - at).min(max_step)
                            .min(angle_step / (omega.abs() * tau).max(1e-6));
                        let dt = tau * (-(-ds).exp_m1());
                        let mid = std::array::from_fn(|c| point[c] + 0.5 * dt * v[c]);
                        let Some((mv, _)) = self.field(mid, tau - 0.5 * dt) else { break; };
                        let next = std::array::from_fn(|c| point[c] + dt * mv[c]);
                        at += ds;
                        if let Some((velocity, _)) = self.field(next, (-at).exp()) {
                            let ell = next[0] * velocity[1] - next[1] * velocity[0];
                            let color = sign * (1.0 + (ell.abs() / birth_momentum.abs()).clamp(0.0, 1.0)) as f32;
                            if point[2].abs() * zoom <= CHANNEL_HALF && next[2].abs() * zoom <= CHANNEL_HALF {
                                canonical.push((point, next, color));
                            }
                            xy.extend_from_slice(&[(next[0] / radius) as f32, (next[1] / radius) as f32]);
                        }
                        point = next;
                    }
                    if at < s - 1e-8 { continue; }
                    if let Some((v, _)) = self.field(point, (-s).exp()) {
                        let momentum = point[0] * v[1] - point[1] * v[0];
                        let omega = momentum / (point[0] * point[0] + point[1] * point[1]).max(1e-300);
                        if cohort == (band - 3).max(0) && ring == 1 && (layer == 1 || layer == 2) {
                            result.momentum[side] = momentum;
                            result.omega[side] = omega;
                            result.radius_ratio[side] = point[0].hypot(point[1]) / radius;
                            result.phases[side] = xy;
                        }
                        for k in 0..8 {
                            let theta = 2.0 * PI * k as f64 / 8.0 + cohort as f64 * 0.37;
                            let (st, ct) = theta.sin_cos();
                            let rotate = |p: [f64; 3]| [
                                ((p[0] * ct - p[1] * st) * zoom) as f32,
                                ((p[0] * st + p[1] * ct) * zoom) as f32,
                                (p[2] * zoom) as f32,
                            ];
                            for (a, b, color) in &canonical {
                                for p in [rotate(*a), rotate(*b)] {
                                    result.lines.extend_from_slice(&[p[0], p[1], p[2], *color]);
                                }
                            }
                            if point[2].abs() * zoom <= CHANNEL_HALF {
                                let p = rotate(point);
                                result.dots.extend_from_slice(&[p[0], p[1], p[2], sign * 2.0]);
                            }
                        }
                    }
                }
            }
        }
        result
    }
    pub fn trajectory_verification(&self) -> String {
        let a = self.integrate_pathlines(500.0, 0.01, 0.04);
        let b = self.integrate_pathlines(500.0, 0.005, 0.02);
        let rel = |x: f64, y: f64| (x - y).abs() / y.abs().max(1e-300);
        let mut out = String::from("{\"log_time\":500,\"method\":\"physical-time midpoint RK2\",\"sides\":[");
        for i in 0..2 {
            if i > 0 { out.push(','); }
            out.push_str(&format!("{{\"side\":\"{}\",\"halving_omega_relative_difference\":{},\"halving_momentum_relative_difference\":{},\"halving_radius_ratio_relative_difference\":{}}}",
                if i == 0 { "lower" } else { "upper" }, rel(a.omega[i], b.omega[i]), rel(a.momentum[i], b.momentum[i]), rel(a.radius_ratio[i], b.radius_ratio[i])));
        }
        out.push_str("]}");
        out
    }
}
