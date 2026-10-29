# 三摆滑轨控制实验

三根均匀钢杆通过铰链串联，底端连接水平滑轨。物理模块计算杆件运动与受力，控制模块依据有限精度传感器的测量调整滑块加速度。杆 1、2、3 的“上 / 下”表示相对于地面的绝对方向。

## 运行与交互

需要 Python、NumPy、SciPy、Numba，以及支持 Web Worker 和 JSON 模块的现代浏览器。在仓库根目录运行：

```powershell
python -m pip install -r triple-pendulum/requirements.txt
python triple-pendulum/server.py
```

打开 <http://127.0.0.1:8771/>。从默认的“下下下”选择“下上下”，可观察摆起和平衡；切回“下下下”可观察受控耗能。其他姿态可作为探索目标。目标切换保持物理状态连续，“重新开始”会重置状态。

拖拽平移、滚轮缩放，双击或点击“全域”恢复视角。侧栏可调整扰动和传感器，切换受力箭头；画面显示杆角、滑块运动、加速度、能量、控制状态和实时曲线。

结束时关闭页面，并在服务终端按 `Ctrl+C`。

## 物理模型

物理与控制分别运行在独立 Worker 中。物理模块使用双精度非线性动力学，外层步长为 1 ms，采用四阶 Runge–Kutta 积分，并在高速运动时细分步长。模型包含铰链黏性阻尼、各杆质心处的独立不规则水平扰动、轨道端点碰撞和电机响应。

| 杆 | 长度 / m | 质量 / kg | 直径 / mm |
|---|---:|---:|---:|
| 1 | 0.323 | 0.876 | 20.974 |
| 2 | 0.419 | 0.938 | 19.055 |
| 3 | 0.484 | 0.553 | 13.613 |

钢密度为 7850 kg/m³；滑块质量为 2 kg，轨道范围 ±0.7 m，速度上限 3 m/s，加速度指令上限 22 m/s²。电机响应使用 5 ms 指令延迟和 20 ms 一阶时间常数。模型参数集中在 [parameters.json](parameters.json)。

杆件采用均匀圆杆与二维运动模型，分别位于不同平行层，二维投影可以重合；杆件间碰撞不计入模型。电机和阻尼参数为演示设定。

## 传感与控制

默认传感器为 100 Hz 采样、12 位角度编码器、0.1 mm 位置分辨率和 10 ms 测量延迟，并加入可复现噪声。控制器从位置和角度测量估计速度，使用离散 LQR 稳定平衡姿态；姿态切换由后台的受约束非线性轨迹规划和反馈跟踪完成。

重点切换为“下下下 ↔ 下上下”。较强扰动或不同传感器条件下，切换和平衡结果可能不同。默认每根杆的扰动幅度上限为 0.02 N，可在界面调整。

## 验证与参考

在本目录运行 `python verify.py` 可用 SciPy DOP853 对照物理积分，需要 Node.js；结果写入 `validation/physics.json`。

- [物理与数值验证](validation/physics.json)、[平衡控制验证](validation/closed-loop.json)、[重点切换验证](validation/transition-0-2.json)。
- [画面性能记录](validation/display-performance.json)：记录的前台浏览器绘制约 245–261 FPS、物理步速约 1000 次/s；实际帧率受浏览器和显示设备影响。
- [Glück、Eder、Kugi：三摆实验与控制](https://www.acin.tuwien.ac.at/fileadmin/cds/pre_post_print/glueck2013.pdf)；[MIT Underactuated Robotics：LQR](https://underactuated.mit.edu/lqr.html)。
