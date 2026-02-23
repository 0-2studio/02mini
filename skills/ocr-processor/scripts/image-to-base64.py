#!/usr/bin/env python3
"""
图片转Base64工具
用于将图片文件转换为Base64格式，以便通过OCR.space API进行文字识别
"""

import base64
import os
import sys

def image_to_base64(image_path):
    """
    将图片文件转换为Base64字符串
    
    Args:
        image_path: 图片文件路径
    
    Returns:
        str: Base64编码的图片字符串，包含MIME类型前缀
    """
    if not os.path.exists(image_path):
        return f"错误：文件不存在 - {image_path}"
    
    # 获取文件扩展名确定MIME类型
    file_ext = os.path.splitext(image_path)[1].lower()
    
    mime_types = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.bmp': 'image/bmp',
        '.tiff': 'image/tiff',
        '.tif': 'image/tiff'
    }
    
    mime_type = mime_types.get(file_ext, 'image/jpeg')  # 默认使用jpeg
    
    try:
        with open(image_path, 'rb') as image_file:
            # 读取图片二进制数据
            image_data = image_file.read()
            
            # 转换为base64
            base64_data = base64.b64encode(image_data).decode('utf-8')
            
            # 添加MIME类型前缀
            base64_with_prefix = f"data:{mime_type};base64,{base64_data}"
            
            return base64_with_prefix
            
    except Exception as e:
        return f"错误：无法读取图片文件 - {str(e)}"

def process_ocr_image(image_path):
    """
    处理OCR图片转换
    
    Args:
        image_path: 图片文件路径
    
    Returns:
        dict: 包含base64数据和处理结果
    """
    result = {
        'success': False,
        'base64_data': None,
        'error': None,
        'file_size': None,
        'mime_type': None
    }
    
    try:
        # 检查文件大小
        file_size = os.path.getsize(image_path)
        result['file_size'] = f"{file_size / 1024:.2f} KB"
        
        # 转换为base64
        base64_data = image_to_base64(image_path)
        
        if base64_data.startswith('错误'):
            result['error'] = base64_data
        else:
            result['success'] = True
            result['base64_data'] = base64_data
            result['mime_type'] = base64_data.split(':')[1].split(';')[0]
            
    except Exception as e:
        result['error'] = f"处理失败: {str(e)}"
    
    return result

def main():
    """主函数 - 处理命令行参数"""
    if len(sys.argv) != 2:
        print("用法: python image-to-base64.py <图片文件路径>")
        print("示例: python image-to-base64.py /path/to/image.png")
        sys.exit(1)
    
    image_path = sys.argv[1]
    
    print(f"正在处理图片: {image_path}")
    
    # 处理图片
    result = process_ocr_image(image_path)
    
    if result['success']:
        print("✅ 转换成功!")
        print(f"📁 文件大小: {result['file_size']}")
        print(f"📄 MIME类型: {result['mime_type']}")
        print(f"🔗 Base64长度: {len(result['base64_data'])} 字符")
        print("\n📋 Base64数据:")
        print(result['base64_data'])
        
        # 保存到文件
        output_file = image_path.rsplit('.', 1)[0] + '_base64.txt'
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(result['base64_data'])
        print(f"\n💾 已保存到: {output_file}")
        
    else:
        print(f"❌ {result['error']}")

if __name__ == "__main__":
    main()