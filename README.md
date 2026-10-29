# Interesting Exp Demo

交互式科学计算动画，使用自编数值方法探索流体、电磁场、磁流体与机械控制。各实验位于独立目录，运行和模型说明见对应文档。

## 实验

| 项目 | 演示内容 |
|---|---|
| [Navier–Stokes](navier-stokes/README.md) | 有限阶局部自相似涡核与旋转流场 |
| [卡门涡街](karman-vortex/README.md) | GPU CFD 圆柱绕流与交替脱涡 |
| [Kelvin–Helmholtz 不稳定性](kelvin-helmholtz/README.md) | GPU CFD 剪切层卷吸与涡旋演化 |
| [三维机翼翼尖涡](wingtip-vortex/README.md) | NASA CRM-HL 参考翼面与 CFD 尾迹 |
| [光子晶体](photonic-crystal/README.md) | Maxwell FDTD 电磁波传播与缺陷导光 |
| [磁流体与太阳耀斑](solar-reconnection/README.md) | 二维磁流体电流片与磁重联 |
| [三摆滑轨控制](triple-pendulum/README.md) | 受限传感下的摆系统平衡与姿态切换 |

## 画面预览

三维机翼翼尖涡：

![三维机翼翼尖涡](wingtip-vortex/assets/performance-preview.png)

光子晶体中的电磁波：

![光子晶体电磁波传播](photonic-crystal/assets/optimized.png)

磁流体中的电流片与磁力线：

![二维磁流体电流片与磁力线](solar-reconnection/assets/preview.png)

## 获取与运行

```powershell
git clone https://github.com/Bohao-Ding/Interesting-Exp-Demo.git
cd Interesting-Exp-Demo
cargo run --release --manifest-path karman-vortex/Cargo.toml
```

以上命令启动卡门涡街实验，打开 <http://127.0.0.1:8766/> 即可观看。其他实验的依赖、运行和关闭方法见各自的说明。
