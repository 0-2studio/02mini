#!/usr/bin/env python3
"""
测试OCR脚本 - 执行图片识别
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from ocr_request import process_image_for_ocr

def main():
    image_path = "files/qq-uploads/2026-02-23/DIYface (1).png"
    api_key = "K83647232688957"
    
    print("正在处理图片...")
    result = process_image_for_ocr(image_path, api_key)
    print("识别结果:")
    print(result)

if __name__ == "__main__":
    main()