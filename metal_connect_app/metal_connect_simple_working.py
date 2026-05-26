import os
import sys


sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from metal_connect_app.app import run


if __name__ == "__main__":
    run()
