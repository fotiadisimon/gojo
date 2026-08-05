"""便捷启动脚本

在项目根目录跑：
    python run.py

等同于：
    python -m backend.gojo_server
"""
from backend.gojo_server import main

if __name__ == '__main__':
    main()
