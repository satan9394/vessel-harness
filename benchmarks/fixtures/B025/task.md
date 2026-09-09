# B025 — interrupt（打断后半程输出，kind=interrupted）

读取 `notes/data.txt` 并基于其内容给出完整分析与结论。

运行中会有人为打断（interrupt）：后半天输出不会完成，
本轮以 `kind=interrupted` 收尾（turn/start → turn/end 配对保持）。