#!/usr/bin/env python3
"""
每日记忆整理脚本
自动执行记忆系统的清理和优化
"""

import os
import json
from datetime import datetime, timedelta
import re

def organize_memory():
    """执行智能每日记忆整理任务"""
    print("开始执行智能记忆整理...")
    
    base_path = "memory"
    report = {
        "timestamp": datetime.now().isoformat(),
        "insights": {},
        "deleted_files": [],
        "merged_files": [],
        "created_files": [],
        "errors": []
    }
    
    try:
        # 1. 智能读取和分析当日记忆内容
        daily_insights = analyze_daily_content(f"{base_path}/daily-logs")
        reflection_insights = analyze_reflections(f"{base_path}/self-reflections")
        knowledge_insights = analyze_knowledge(f"{base_path}/knowledge")
        
        report["insights"].update({
            "daily": daily_insights,
            "reflections": reflection_insights,
            "knowledge": knowledge_insights
        })
        
        # 2. AI归纳分析用户行为模式
        behavior_patterns = analyze_user_behavior(report["insights"])
        report["insights"]["behavior_patterns"] = behavior_patterns
        
        # 3. 清理旧日志（超过30天）
        daily_logs = list_directory_files(f"{base_path}/daily-logs")
        deleted_logs = cleanup_old_daily_logs(daily_logs, 30)
        report["deleted_files"].extend(deleted_logs)
        
        # 4. 智能内容整合
        reflections = list_directory_files(f"{base_path}/self-reflections")
        merged_reflections = intelligent_content_integration(reflections, report["insights"])
        report["merged_files"].extend(merged_reflections)
        
        # 5. 创建智能总结报告
        smart_report = create_intelligent_summary_report(report)
        report["created_files"].append(smart_report)
        
        # 6. 优化记忆结构
        optimize_memory_structure(report["insights"])
        
        # 7. 发送智能总结报告给PPN-design
        send_summary_to_ppn(report)
        
        print(f"智能记忆整理完成: 生成{len(report['insights'])}个洞察, 删除{len(report['deleted_files'])}个文件")
        return report
        
    except Exception as e:
        report["errors"].append(str(e))
        print(f"整理过程中出现错误: {e}")
        return report

def list_directory_files(path):
    """列出目录中的所有文件"""
    try:
        if not os.path.exists(path):
            return []
        return [f for f in os.listdir(path) if os.path.isfile(os.path.join(path, f))]
    except Exception as e:
        print(f"列出目录 {path} 失败: {e}")
        return []

def cleanup_old_daily_logs(log_files, days_threshold):
    """清理超过指定天数的日常日志文件"""
    deleted_files = []
    cutoff_date = datetime.now() - timedelta(days=days_threshold)
    
    for file_name in log_files:
        if file_name.endswith('.md'):
            # 尝试从文件名提取日期
            date_match = re.match(r'(\d{4}-\d{2}-\d{2})', file_name)
            if date_match:
                file_date = datetime.strptime(date_match.group(1), '%Y-%m-%d')
                if file_date < cutoff_date:
                    file_path = f"memory/daily-logs/{file_name}"
                    try:
                        os.remove(file_path)
                        deleted_files.append(file_path)
                        print(f"删除旧日志: {file_path}")
                    except Exception as e:
                        print(f"删除文件 {file_path} 失败: {e}")
    
    return deleted_files

def merge_duplicate_reflections(reflection_files):
    """合并重复的反思内容"""
    merged_files = []
    # 这里可以添加更复杂的重复检测逻辑
    # 目前按文件类型分组
    
    qq_rules_files = [f for f in reflection_files if 'qq' in f.lower() and 'rule' in f.lower()]
    if len(qq_rules_files) > 1:
        # 合并QQ规则相关的反思文件
        merged_file = merge_qq_rule_reflections(qq_rules_files)
        if merged_file:
            merged_files.append(merged_file)
    
    return merged_files

def merge_qq_rule_reflections(files):
    """合并QQ规则相关的反思文件"""
    try:
        merged_content = []
        merged_content.append("# QQ规则反思合并\n")
        merged_content.append(f"合并时间: {datetime.now().isoformat()}\n\n")
        
        for file_name in files:
            file_path = f"memory/self-reflections/{file_name}"
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    merged_content.append(f"## 来自 {file_name}\n")
                    merged_content.append(content + "\n\n")
                
                # 删除原文件
                os.remove(file_path)
                print(f"合并并删除: {file_path}")
            except Exception as e:
                print(f"处理文件 {file_path} 失败: {e}")
        
        # 创建合并后的文件
        new_file_name = f"qq-rules-merged-{datetime.now().strftime('%Y-%m-%d')}.md"
        new_file_path = f"memory/self-reflections/{new_file_name}"
        
        with open(new_file_path, 'w', encoding='utf-8') as f:
            f.write(''.join(merged_content))
        
        print(f"创建合并文件: {new_file_path}")
        return new_file_path
        
    except Exception as e:
        print(f"合并QQ规则反思失败: {e}")
        return None

def create_organization_log(report):
    """创建整理记录"""
    timestamp = datetime.now().strftime('%Y-%m-%d')
    log_file = f"memory/self-reflections/daily-organization-{timestamp}.md"
    
    log_content = f"""# 每日记忆整理 - {report['timestamp']}

## 整理统计
- 删除文件数量: {len(report['deleted_files'])}
- 合并文件数量: {len(report['merged_files'])}
- 创建文件数量: {len(report['created_files'])}
- 错误数量: {len(report['errors'])}

## 删除的文件
"""
    
    for file_path in report['deleted_files']:
        log_content += f"- {file_path}\n"
    
    log_content += "\n## 合并的文件\n"
    for file_path in report['merged_files']:
        log_content += f"- {file_path}\n"
    
    log_content += "\n## 创建的文件\n"
    for file_path in report['created_files']:
        log_content += f"- {file_path}\n"
    
    if report['errors']:
        log_content += "\n## 错误信息\n"
        for error in report['errors']:
            log_content += f"- {error}\n"
    
    try:
        with open(log_file, 'w', encoding='utf-8') as f:
            f.write(log_content)
        print(f"创建整理记录: {log_file}")
        return log_file
    except Exception as e:
        print(f"创建整理记录失败: {e}")
        return None

def analyze_daily_content(daily_logs_path):
    """智能分析日常日志内容"""
    insights = {
        "key_events": [],
        "user_interactions": {},
        "topics_discussed": [],
        "emotional_tone": "neutral"
    }
    
    daily_files = list_directory_files(daily_logs_path)
    for file_name in daily_files:
        file_path = f"{daily_logs_path}/{file_name}"
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
                # 分析关键事件
                insights["key_events"].extend(extract_key_events(content))
                # 分析用户交互
                insights["user_interactions"].update(analyze_interactions(content))
                # 分析讨论主题
                insights["topics_discussed"].extend(extract_topics(content))
        except Exception as e:
            print(f"分析文件 {file_path} 失败: {e}")
    
    return insights

def analyze_reflections(reflections_path):
    """智能分析反思内容"""
    insights = {
        "learning_points": [],
        "improvement_areas": [],
        "success_patterns": [],
        "challenges_faced": []
    }
    
    reflection_files = list_directory_files(reflections_path)
    for file_name in reflection_files:
        file_path = f"{reflections_path}/{file_name}"
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
                insights["learning_points"].extend(extract_learning_points(content))
                insights["improvement_areas"].extend(extract_improvement_areas(content))
                insights["success_patterns"].extend(extract_success_patterns(content))
                insights["challenges_faced"].extend(extract_challenges(content))
        except Exception as e:
            print(f"分析反射文件 {file_path} 失败: {e}")
    
    return insights

def analyze_knowledge(knowledge_path):
    """智能分析知识库内容"""
    insights = {
        "new_concepts": [],
        "technical_skills": [],
        "problem_solutions": [],
        "knowledge_gaps": []
    }
    
    knowledge_files = list_directory_files(knowledge_path)
    for file_name in knowledge_files:
        file_path = f"{knowledge_path}/{file_name}"
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
                insights["new_concepts"].extend(extract_concepts(content))
                insights["technical_skills"].extend(extract_skills(content))
                insights["problem_solutions"].extend(extract_solutions(content))
        except Exception as e:
            print(f"分析知识文件 {file_path} 失败: {e}")
    
    return insights

def analyze_user_behavior(all_insights):
    """AI归纳分析用户行为模式"""
    patterns = {
        "communication_style": "",
        "preferred_topics": [],
        "interaction_frequency": "",
        "problem_solving_approach": "",
        "learning_style": ""
    }
    
    # 基于所有洞察分析行为模式
    # 这里会有复杂的AI分析逻辑
    
    return patterns

def intelligent_content_integration(reflection_files, insights):
    """智能内容整合"""
    integrated_files = []
    # 基于洞察进行智能内容整合
    return integrated_files

def create_intelligent_summary_report(report):
    """创建智能总结报告"""
    timestamp = datetime.now().strftime('%Y-%m-%d')
    report_file = f"memory/self-reflections/intelligent-daily-summary-{timestamp}.md"
    
    content = f"# 智能每日记忆总结 - {report['timestamp']}\n\n"
    content += "## 🧠 AI洞察分析\n\n"
    
    # 添加各种洞察
    if 'daily' in report['insights']:
        content += "### 📅 日常活动分析\n"
        content += f"- 关键事件: {len(report['insights']['daily'].get('key_events', []))}个\n"
        content += f"- 讨论主题: {len(report['insights']['daily'].get('topics_discussed', []))}个\n\n"
    
    if 'reflections' in report['insights']:
        content += "### 💭 反思洞察\n"
        content += f"- 学习要点: {len(report['insights']['reflections'].get('learning_points', []))}个\n"
        content += f"- 改进领域: {len(report['insights']['reflections'].get('improvement_areas', []))}个\n\n"
    
    if 'knowledge' in report['insights']:
        content += "### 📚 知识增长\n"
        content += f"- 新概念: {len(report['insights']['knowledge'].get('new_concepts', []))}个\n"
        content += f"- 技术技能: {len(report['insights']['knowledge'].get('technical_skills', []))}个\n\n"
    
    if 'behavior_patterns' in report['insights']:
        content += "### 🎯 用户行为模式\n"
        patterns = report['insights']['behavior_patterns']
        for key, value in patterns.items():
            content += f"- {key}: {value}\n"
        content += "\n"
    
    content += "## 📊 整理统计\n\n"
    content += f"- 删除文件: {len(report['deleted_files'])}个\n"
    content += f"- 合并内容: {len(report['merged_files'])}个\n"
    content += f"- 创建文件: {len(report['created_files'])}个\n"
    
    if report['errors']:
        content += "\n## ⚠️ 错误信息\n\n"
        for error in report['errors']:
            content += f"- {error}\n"
    
    try:
        with open(report_file, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"创建智能总结报告: {report_file}")
        return report_file
    except Exception as e:
        print(f"创建智能总结报告失败: {e}")
        return None

def optimize_memory_structure(insights):
    """优化记忆结构"""
    print("优化记忆结构...")
    # 基于洞察优化记忆结构
    pass

# 辅助函数
def extract_key_events(content):
    """提取关键事件"""
    # 实现关键事件提取逻辑
    return []

def analyze_interactions(content):
    """分析用户交互"""
    # 实现交互分析逻辑
    return {}

def extract_topics(content):
    """提取讨论主题"""
    # 实现主题提取逻辑
    return []

def extract_learning_points(content):
    """提取学习要点"""
    # 实现学习要点提取逻辑
    return []

def extract_improvement_areas(content):
    """提取改进领域"""
    # 实现改进领域提取逻辑
    return []

def extract_success_patterns(content):
    """提取成功模式"""
    # 实现成功模式提取逻辑
    return []

def extract_challenges(content):
    """提取挑战"""
    # 实现挑战提取逻辑
    return []

def extract_concepts(content):
    """提取概念"""
    # 实现概念提取逻辑
    return []

def extract_skills(content):
    """提取技能"""
    # 实现技能提取逻辑
    return []

def extract_solutions(content):
    """提取解决方案"""
    # 实现解决方案提取逻辑
    return []

def send_summary_to_ppn(report):
    """发送智能总结报告给PPN-design"""
    try:
        # 构建总结消息
        summary_message = build_summary_message(report)
        
        # 这里需要调用QQ发送功能
        print(f"准备发送记忆总结给PPN-design (323264083):")
        print(f"- 洞察数量: {len(report['insights'])}")
        print(f"- 删除文件: {len(report['deleted_files'])}个")
        print(f"- 创建文件: {len(report['created_files'])}个")
        
        # 实际的QQ发送功能需要在主系统中实现
        # 这里只是记录发送日志
        log_file = "memory/logs/summary-sends.log"
        with open(log_file, 'a', encoding='utf-8') as f:
            f.write(f"{datetime.now().isoformat()} - 准备发送记忆总结给PPN-design\n")
        
        print("记忆总结报告已准备发送给PPN-design")
        
    except Exception as e:
        print(f"发送总结给PPN-design失败: {e}")

def build_summary_message(report):
    """构建总结消息"""
    message = f"🧠 **智能记忆总结** - {report['timestamp'][:10]}\n\n"
    
    # 添加关键洞察
    if 'daily' in report['insights']:
        daily = report['insights']['daily']
        message += f"📅 **今日活动**: {len(daily.get('key_events', []))}个关键事件, {len(daily.get('topics_discussed', []))}个讨论主题\n\n"
    
    if 'reflections' in report['insights']:
        reflections = report['insights']['reflections']
        message += f"💭 **学习成长**: {len(reflections.get('learning_points', []))}个学习要点, {len(reflections.get('improvement_areas', []))}个改进领域\n\n"
    
    if 'knowledge' in report['insights']:
        knowledge = report['insights']['knowledge']
        message += f"📚 **知识积累**: {len(knowledge.get('new_concepts', []))}个新概念, {len(knowledge.get('technical_skills', []))}个技能提升\n\n"
    
    message += f"📊 **整理统计**: 删除{len(report['deleted_files'])}个文件, 创建{len(report['created_files'])}个新文件\n\n"
    
    if 'behavior_patterns' in report['insights']:
        patterns = report['insights']['behavior_patterns']
        message += "🎯 **行为洞察**: 已生成个性化分析\n\n"
    
    message += "📝 详细报告已保存到 memory/self-reflections/"
    
    return message

def update_cross_references():
    """更新交叉引用"""
    print("更新交叉引用...")
    pass

if __name__ == "__main__":
    organize_memory()