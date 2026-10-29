# Navier–Stokes 局部涡核 / Local Navier–Stokes Vortex

Rust CPU 内核计算局部自相似涡核的有限阶内区场，WebGL 显示中央旋转层、上下排出通道及随流轨迹。

A Rust CPU kernel evaluates a finite-order inner field for a local self-similar vortex. WebGL displays the rotating core, axial outflow, and particle trajectories.

![中央旋转层与排出通道 / Rotating core and axial outflow](assets/preview.png)

## 运行 / Run

需要 Rust stable（edition 2024）和支持 WebGL 的浏览器。Windows MSVC 环境需要 C++ 构建工具与 Windows SDK。从仓库根目录运行：

Requires Rust stable with edition 2024 support and a WebGL-capable browser. Windows MSVC builds require C++ Build Tools and the Windows SDK. Run from the repository root:

```powershell
cargo run --release --manifest-path navier-stokes/Cargo.toml
```

打开 <http://127.0.0.1:8765/>。结束时在终端按 `Ctrl+C` 停止 CPU 计算服务，并关闭页面。

Open <http://127.0.0.1:8765/>. Press `Ctrl+C` in the terminal to stop the CPU simulation server, then close the page.

## 观察 / Controls

- 播放、暂停与拖动时间；鼠标旋转，滚轮缩放。/ Play, pause, scrub time, rotate with the mouse, and zoom with the wheel.
- 暖色与青色区分上下播种层，浅蓝色表示瞬时轴向流线。/ Warm and cyan colors distinguish upper and lower seed layers; light blue marks instantaneous axial streamlines.
- 随流轨迹亮度表示单位质量轴向角动量相对播种值的变化。/ Trajectory brightness encodes changes in specific axial angular momentum relative to the seed value.
- 支持 PNG 截图与 6 秒 WebM 录制。/ Export PNG images or record a six-second WebM clip.

## 模型 / Model

内区场采用 14 阶径向 Taylor 展开与 513 节点轴向 Hermite 插值。中央显示层为 `|z|≤0.4√τ`，轴向通道延伸至 `|z|≤0.95√τ`；粒子采用物理时间的中点 RK2 积分。三轴等比例，默认随内区收缩统一放大 `1/√τ`，时间显示为 `s=−logτ`。

The inner field uses a 14th-order radial Taylor expansion and axial Hermite interpolation on 513 nodes. The central layer spans `|z|≤0.4√τ`, and outflow channels extend to `|z|≤0.95√τ`. Particles use midpoint RK2 in physical time. All axes share the same scale; the view follows the shrinking inner region with magnification `1/√τ`, and time is shown as `s=−logτ`.

模型采用示例轴压力和有限区间归一化，展示局部有限阶场的演化。完整全局爆破解的匹配与证明条件属于源论文的构造范围。

The model uses an illustrative axial pressure and finite-interval normalization to visualize local finite-order field evolution. Matching and proof conditions for the full global blowup construction are described in the source paper.

## 数值检查与资料 / Verification and details

```powershell
cargo run --release --manifest-path navier-stokes/Cargo.toml -- --verify
cargo run --release --manifest-path navier-stokes/Cargo.toml -- --export
```

`--verify` 检查廓线、散度与粒子步长；`--export` 将检查结果及示例 JSON 帧写入本实验的 `output/`。

`--verify` checks profiles, divergence, and particle time steps. `--export` writes the results and sample JSON frames to this experiment's `output/` directory.

[构造与公式 / Construction and equations](construction_notes.md) · [源论文 / Source paper](https://cdn.openai.com/pdf/32d9f210-8b73-45e0-91bc-82a30aef8a9a/navier-stokes.pdf)
