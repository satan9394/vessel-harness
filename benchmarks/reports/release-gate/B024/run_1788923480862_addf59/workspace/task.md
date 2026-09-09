# B024 — streaming（文本/tool 交错流式断言）

读取 `notes/facts.txt`，然后以**流式**方式产出一段总结文本，
其中必须先流式发起一个 Read 工具调用，再流式给出最终文本结论。

输出必须包含字样：`STREAM-TEXT-GOLDEN-2026`