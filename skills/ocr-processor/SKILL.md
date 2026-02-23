---
name: ocr-processor
description: OCR图片识别文字功能，使用OCR.space API识别图片中的文字
triggers:
  - "When user asks to recognize text from images"
  - "When images need text extraction"
  - "When user provides OCR.space API key"
---

# OCR Processor

## Purpose
Extract text from images using OCR.space API for image recognition capabilities.

## When to Use
- User uploads images and asks for text recognition
- Need to extract readable text from image files
- User provides OCR.space API key for processing

## Instructions

### Step 1: Check API Key
Verify OCR.space API key is available:
- Default key: K83647232688957 (provided by PPN-design)
- Check if key is valid and working

### Step 2: Process Image
When image is received:
1. Get image file from files/qq-uploads/ or provided path
2. Prepare OCR.space API request
3. Send image to OCR.space for text extraction
4. Process and format the extracted text

### Step 3: Return Results
- Extract text content
- Format for readability
- Handle errors gracefully

## Parameters
- image_path: Path to the image file to process
- api_key: OCR.space API key (default available)
- language: Recognition language (optional, default auto)
- output_format: Text format preference (plain text recommended)

## Scripts

### ocr-request
- **Purpose**: Send image to OCR.space API
- **Usage**: Make HTTP POST request to OCR.space endpoint
- **Arguments**: image file, API key, language settings
- **Returns**: Extracted text data

## Examples

### Example 1: QQ Image Processing
**Input**: User sends QQ image in chat
**Process**: 
1. Download image from QQ to files/qq-uploads/
2. Call OCR.space API with image
3. Extract and format text
**Output**: "识别到的文字：[extracted text content]"

### Example 2: File Path Processing
**Input**: User provides image file path
**Process**: Read file and send to OCR API
**Output**: Formatted text content from image

## API Details
- Endpoint: https://api.ocr.space/parse/image
- Method: POST
- Required: file or URL, API key
- Optional: language, isOverlayRequired, filetype
- Response: JSON with ParsedResults containing text

## Error Handling
- Invalid API key: Inform user to check credentials
- Image format not supported: Suggest supported formats
- Network issues: Retry or suggest alternative
- Low quality images: Suggest better image quality

## Notes
- OCR.space supports various image formats (PNG, JPG, GIF, BMP, TIFF)
- Free tier has limitations on API calls per month
- Best results with clear, high-contrast images
- Chinese text recognition may require specific language settings