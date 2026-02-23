#!/usr/bin/env python3
"""
测试Base64转换和OCR API调用
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from image_to_base64 import process_ocr_image
import requests
import json

def test_ocr_with_base64(image_path, api_key='K83647232688957'):
    """
    使用Base64格式调用OCR.space API
    
    Args:
        image_path: 图片文件路径
        api_key: OCR.space API密钥
    
    Returns:
        dict: OCR识别结果
    """
    print("🔄 步骤1: 转换图片为Base64...")
    
    # 转换图片为base64
    conversion_result = process_ocr_image(image_path)
    
    if not conversion_result['success']:
        return {
            'success': False,
            'error': f"Base64转换失败: {conversion_result['error']}"
        }
    
    print("✅ Base64转换成功!")
    print(f"📁 文件大小: {conversion_result['file_size']}")
    print(f"📄 MIME类型: {conversion_result['mime_type']}")
    
    print("\n🔄 步骤2: 调用OCR.space API...")
    
    # 准备API请求
    url = 'https://api.ocr.space/parse/image'
    
    payload = {
        'apikey': api_key,
        'base64Image': conversion_result['base64_data'],
        'language': 'chs',
        'isOverlayRequired': False,
        'detectOrientation': True,
        'scale': True,
        'OCREngine': 2
    }
    
    try:
        response = requests.post(url, data=payload)
        ocr_result = response.json()
        
        if ocr_result.get('IsErroredOnProcessing', False):
            return {
                'success': False,
                'error': ocr_result.get('ErrorMessage', 'OCR处理错误'),
                'details': ocr_result.get('ErrorDetails', '')
            }
        
        # 提取识别的文字
        parsed_results = ocr_result.get('ParsedResults', [])
        if not parsed_results:
            return {
                'success': False,
                'error': '未识别到文字内容'
            }
        
        extracted_text = parsed_results[0].get('ParsedText', '').strip()
        
        return {
            'success': True,
            'text': extracted_text,
            'processing_time': ocr_result.get('ProcessingTimeInMilliseconds', 'unknown'),
            'exit_code': ocr_result.get('OCRExitCode', 'unknown')
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': f"API调用失败: {str(e)}"
        }

def main():
    """主函数"""
    # 测试图片路径
    test_image = "files/qq-uploads/2026-02-23/DIYface (1).png"
    
    print("🧪 OCR Base64测试开始")
    print("=" * 50)
    
    # 检查文件是否存在
    if not os.path.exists(test_image):
        print(f"❌ 测试图片不存在: {test_image}")
        return
    
    print(f"📷 测试图片: {test_image}")
    
    # 执行OCR测试
    result = test_ocr_with_base64(test_image)
    
    print("\n" + "=" * 50)
    print("📊 测试结果:")
    
    if result['success']:
        print("✅ OCR识别成功!")
        print(f"⏱️ 处理时间: {result['processing_time']}ms")
        print(f"📋 退出代码: {result['exit_code']}")
        print("\n📝 识别文字:")
        print("-" * 30)
        print(result['text'])
        print("-" * 30)
    else:
        print("❌ OCR识别失败!")
        print(f"🚫 错误信息: {result['error']}")
        if result.get('details'):
            print(f"📄 详细信息: {result['details']}")

if __name__ == "__main__":
    main()