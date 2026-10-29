# 三摆滑轨控制 / Cart–Triple-Pendulum Control

三根均匀钢杆通过铰链串联，底端连接水平滑轨。独立的物理模块计算运动和受力，控制模块依据有限精度传感器测量调整滑块加速度。杆 1、2、3 的“上 / 下”表示相对于地面的绝对方向。

Three uniform steel rods are linked by hinges to a horizontal cart. An independent physics module computes motion and forces, while the controller adjusts cart acceleration using limited-precision sensor measurements. “Up/down” refers to each rod's absolute direction relative to the ground.

## 运行 / Run

需要 Python、NumPy、SciPy、Numba，以及支持 Web Worker 和 JSON 模块的浏览器。从仓库根目录运行：

Requires Python, NumPy, SciPy, Numba, and a browser supporting Web Workers and JSON modules. Run from the repository root:

```powershell
python -m pip install -r triple-pendulum/requirements.txt
python triple-pendulum/server.py
```

打开 <http://127.0.0.1:8771/>。结束时关闭页面，并在终端按 `Ctrl+C`。

Open <http://127.0.0.1:8771/>. To stop, close the page and press `Ctrl+C` in the terminal.

## 交互 / Controls

- 从“下下下”选择“下上下”观察摆起和平衡，切回“下下下”观察受控耗能；其他姿态为探索目标。/ Switch from down–down–down to down–up–down for swing-up and balance, then back for controlled energy dissipation; other targets are exploratory.
- 目标切换保持物理状态连续，“重新开始”重置状态。/ Target changes preserve the physical state; “重新开始” (Restart) resets it.
- 拖拽平移、滚轮缩放，双击或“全域”恢复视角。/ Drag to pan, wheel to zoom, and double-click or choose “全域” (Fit) to reset the view.
- 调节扰动、采样率、编码器分辨率和测量延迟，切换受力箭头。/ Adjust disturbances, sampling rate, encoder resolution, and measurement delay, and toggle force arrows.
- 实时查看杆角、滑块运动、加速度、能量和控制状态。/ Inspect rod angles, cart motion, acceleration, energy, and controller status in real time.

## 物理模型 / Physics model

物理与控制分别运行在独立 Worker 中。物理模块使用双精度非线性动力学、1 ms 外层步长和四阶 Runge–Kutta 积分，高速运动时细分步长。模型包括铰链黏性阻尼、质心处的不规则水平外力、轨道端点碰撞和电机响应。

Physics and control run in separate workers. The physics module uses double-precision nonlinear dynamics, a 1 ms outer time step, and fourth-order Runge–Kutta integration with substeps during fast motion. The model includes viscous hinge damping, irregular horizontal forces at rod centers, rail-end impacts, and motor response.

| 杆 / Rod | 长度 / Length (m) | 质量 / Mass (kg) | 直径 / Diameter (mm) |
|---|---:|---:|---:|
| 1 | 0.323 | 0.876 | 20.974 |
| 2 | 0.419 | 0.938 | 19.055 |
| 3 | 0.484 | 0.553 | 13.613 |

钢密度为 7850 kg/m³；滑块质量 2 kg，轨道 ±0.7 m，速度上限 3 m/s，加速度指令上限 22 m/s²。电机采用 5 ms 指令延迟和 20 ms 一阶响应时间常数。各杆位于平行层，二维投影可以重合，模型忽略杆间碰撞。

Steel density is 7850 kg/m³. The cart mass is 2 kg, rail travel is ±0.7 m, speed is limited to 3 m/s, and acceleration commands to 22 m/s². The motor has a 5 ms command delay and a 20 ms first-order time constant. Rods occupy parallel layers, allowing overlapping 2D projections; inter-rod collisions are omitted.

## 传感与控制 / Sensing and control

默认设置为 100 Hz 采样、12 位角编码器、0.1 mm 位置分辨率和 10 ms 延迟，并加入可复现噪声。控制器从位置和角度估计速度，针对八种竖直姿态设计离散 LQR，通过后台非线性轨迹规划与反馈跟踪完成切换。

Defaults are 100 Hz sampling, 12-bit angular encoders, 0.1 mm position resolution, and 10 ms latency with reproducible noise. The controller estimates velocity from position and angle measurements, uses discrete LQR around eight vertical equilibria, and follows constrained nonlinear trajectories planned in the background.

重点切换为“下下下 ↔ 下上下”，默认每杆扰动力上限为 0.02 N。电机与阻尼参数为演示设定，强扰动下可能失稳。

The primary transition is down–down–down ↔ down–up–down, with a default disturbance limit of 0.02 N per rod. Motor and damping parameters are illustrative; strong disturbances can destabilize the controller.

## 数值检查与资料 / Verification and details

在本目录运行 `python verify.py`，使用 SciPy DOP853 对照积分结果，需要 Node.js，结果写入 `validation/physics.json`。

Run `python verify.py` from this directory to compare integration against SciPy DOP853. This requires Node.js and writes `validation/physics.json`.

[模型参数 / Parameters](parameters.json) · [物理验证 / Physics checks](validation/physics.json) · [平衡控制 / Balance checks](validation/closed-loop.json) · [重点切换 / Transition checks](validation/transition-0-2.json)

[三摆实验与控制 / Triple-pendulum experiment](https://www.acin.tuwien.ac.at/fileadmin/cds/pre_post_print/glueck2013.pdf) · [MIT LQR](https://underactuated.mit.edu/lqr.html)
