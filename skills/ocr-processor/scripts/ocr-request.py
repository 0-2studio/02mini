#!/usr/bin/env python3
"""
OCR.space API Request Script
用于向OCR.space发送图片并获取识别结果
"""

import requests
import json
import base64
import os

def ocr_space_file(filename, api_key='K83647232688957', language='chs'):
    """
    OCR.space API 调用函数
    
    Args:
        filename: 图片文件路径
        api_key: OCR.space API密钥
        language: 识别语言 (chs=中文简体, eng=英文, auto=自动)
    
    Returns:
        dict: OCR识别结果
    """
    url = 'https://api.ocr.space/parse/image'
    
    with open(filename, 'rb') as f:
        payload = {
            'apikey': api_key,
            'language': language,
            'isOverlayRequired': False,
            'detectOrientation': True,
            'scale': True,
            'OCREngine': 2
        }
        
        files = {
            'file': f
        }
        
        try:
            response = requests.post(url, files=files, data=payload)
            result = response.json()
            
            if result.get('IsErroredOnProcessing', False):
                return {'error': result.get('ErrorMessage', 'Unknown error')}
            
            return result
            
        except Exception as e:
            return {'error': str(e)}

def extract_text_from_result(ocr_result):
    """
    从OCR结果中提取纯文本
    
    Args:
        ocr_result: OCR.space API返回的结果
    
    Returns:
        str: 提取的文本内容
    """
    if 'error' in ocr_result:
        return f"OCR错误: {ocr_result['error']}"
    
    parsed_results = ocr_result.get('ParsedResults', [])
    if not parsed_results:
        return "未识别到文字内容"
    
    text_lines = []
    for result in parsed_results:
        text = result.get('ParsedText', '')
        if text.strip():
            text_lines.append(text.strip())
    
    return '\n'.join(text_lines) if text_lines else "未识别到有效文字"

def image_to_base64(image_path):
    """
    将图片文件转换为base64字符串
    
    Args:
        image_path: 图片文件路径
    
    Returns:
        str: base64编码的图片字符串
    """
    if not os.path.exists(image_path):
        return f"文件不存在: {image_path}"
    
    with open(image_path, 'rb') as image_file:
        image_data = image_file.read()
        base64_data = base64.b64encode(image_data).decode('utf-8')
        
    # 根据文件扩展名确定MIME类型
    _, ext = os.path.splitext(image_path.lower())
    mime_types = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.bmp': 'image/bmp',
        '.tiff': 'image/tiff',
        '.tif': 'image/tiff'
    }
    
    mime_type = mime_types.get(ext, 'image/png')
    return f"data:{mime_type};base64,{base64_data}"

def ocr_space_base64(base64_image, api_key='K83647232688957', language='chs'):
    """
    使用base64字符串调用OCR.space API
    
    Args:
        base64_image: base64编码的图片字符串
        api_key: OCR.space API密钥
        language: 识别语言
    
    Returns:
        dict: OCR识别结果
    """
    url = 'https://api.ocr.space/parse/image'
    
    payload = {
        'apikey': api_key,
        'base64Image': base64_image,
        'language': language,
        'isOverlayRequired': False,
        'detectOrientation': True,
        'scale': True,
        'OCREngine': 2
    }
    
    try:
        response = requests.post(url, data=payload)
        result = response.json()
        
        if result.get('IsErroredOnProcessing', False):
            return {'error': result.get('ErrorMessage', 'Unknown error')}
        
        return result
        
    except Exception as e:
        return {'error': str(e)}

def process_image_for_ocr(image_path, api_key='K83647232688957'):
    """
    完整的图片OCR处理流程（使用base64方法）
    
    Args:
        image_path: 图片文件路径
        api_key: OCR.space API密钥
    
    Returns:
        str: 识别出的文字内容
    """
    if not os.path.exists(image_path):
        return f"文件不存在: {image_path}"
    
    # 转换为base64
    base64_image = image_to_base64(image_path)
    
    # 调用OCR API
    ocr_result = ocr_space_base64(base64_image, api_key)
    
    # 提取文本
    extracted_text = extract_text_from_result(ocr_result)
    
    return extracted_text

if __name__ == "__main__":
    # 测试图片转base64
    test_image = "files/qq-uploads/2026-02-23/DIYface (1).png"
    if os.path.exists(test_image):
        print("正在转换图片为base64...")
        base64_result = image_to_base64(test_image)
        print(f"Base64长度: {len(base64_result)} 字符")
        print(f"Base64前100字符: {base64_result[:100]}...")
        
        print("\n正在进行OCR识别...")
        ocr_result = process_image_for_ocr(test_image)
        print("识别结果:")
        print(ocr_result)
    else:
        print(f"测试图片不存在: {test_image}")

if __name__ == "__main__":
    # 测试用例
    test_image = "test.jpg"
    result = process_image_for_ocr(test_image)
    print("识别结果:")
    print(result)