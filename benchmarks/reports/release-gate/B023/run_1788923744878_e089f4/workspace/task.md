# B023 — Loop Engine 单次迭代闭环

执行一次 Loop Engine 迭代：从任务队列取任务 → 隔离工作区 → Generator 产出 → 独立 Evaluator 评审 → Persist。
任务目标：在隔离工作区写一个含 ENGINE-GOLDEN-88 的文件。
