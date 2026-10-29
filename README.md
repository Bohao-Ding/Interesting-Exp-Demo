# Interesting Exp Demo

交互式科学计算动画，使用自编数值方法探索流体、电磁场、磁流体与机械控制。各实验位于独立目录。

Interactive scientific simulations built with custom numerical solvers, covering fluid dynamics, electromagnetics, magnetohydrodynamics, and mechanical control. Each experiment has its own directory.

## 实验 / Experiments

| 项目 / Project | 演示内容 / What to explore |
|---|---|
| [Navier–Stokes](navier-stokes/README.md) | 有限阶局部自相似涡核 / Finite-order local self-similar vortex |
| [卡门涡街 / Kármán vortex street](karman-vortex/README.md) | 圆柱绕流与交替脱涡 / Cylinder flow and alternating vortex shedding |
| [Kelvin–Helmholtz 不稳定性 / Kelvin–Helmholtz instability](kelvin-helmholtz/README.md) | 剪切层卷吸与涡旋演化 / Shear-layer roll-up and vortex evolution |
| [三维翼尖涡 / 3D wingtip vortices](wingtip-vortex/README.md) | NASA CRM-HL 参考翼面与三维尾迹 / NASA CRM-HL reference wing and 3D wake |
| [光子晶体 / Photonic crystal](photonic-crystal/README.md) | 电磁波传播、缺陷导光与微腔 / Wave propagation, defect waveguides, and cavities |
| [磁重联 / Magnetic reconnection](solar-reconnection/README.md) | 不规则电流片与磁岛演化 / Irregular current sheets and magnetic islands |
| [三摆滑轨控制 / Cart–triple-pendulum control](triple-pendulum/README.md) | 受限传感下的平衡与姿态切换 / Balance and posture transitions with limited sensing |

## 画面预览 / Previews

三维机翼翼尖涡 / 3D wingtip vortices

![三维机翼翼尖涡 / 3D wingtip vortices](wingtip-vortex/assets/performance-preview.png)

光子晶体中的电磁波 / Electromagnetic waves in a photonic crystal

![光子晶体 / Photonic crystal](photonic-crystal/assets/optimized.png)

磁流体中的电流片与磁力线 / Current sheets and magnetic field lines

![磁重联 / Magnetic reconnection](solar-reconnection/assets/preview.png)

## 运行环境 / Requirements

Rust 实验需要支持 edition 2024 的 stable 工具链；Windows MSVC 工具链还需 C++ 构建工具和 Windows SDK。Navier–Stokes 使用 CPU 计算与 WebGL 显示，其余 Rust 实验在支持 WebGPU 的浏览器中计算和显示。三摆实验使用 Python 服务和浏览器 Worker，依赖见其 README。

Rust experiments require a stable toolchain supporting edition 2024. The Windows MSVC toolchain also requires C++ Build Tools and the Windows SDK. Navier–Stokes uses CPU computation and WebGL rendering; the other Rust experiments compute and render in a WebGPU-capable browser. The pendulum experiment uses a Python server and browser workers; see its README for dependencies.

## 获取与运行 / Getting started

```powershell
git clone https://github.com/Bohao-Ding/Interesting-Exp-Demo.git
cd Interesting-Exp-Demo
cargo run --release --manifest-path karman-vortex/Cargo.toml
```

以上命令启动卡门涡街实验，打开 <http://127.0.0.1:8766/> 即可观看。各实验的操作、模型和关闭方法见对应 README。

This launches the Kármán vortex street demo at <http://127.0.0.1:8766/>. Each experiment's README covers its controls, model, and shutdown procedure.
