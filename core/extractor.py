#Actionableitems , decision , questions 

from langchain_mistralai import ChatMistralAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough, RunnableLambda
import os 


def get_llm():
    return ChatMistralAI(model = "mistral-small-latest", mistral_api_key = os.getenv("MISTRAL_API_KEY"),temperature=0.2)



def build_chain(system_prompt : str):
    llm = get_llm()
    return (
        RunnablePassthrough() | RunnableLambda(lambda x : {"text" : x}) |ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        ("human","{text}"),
    ]) | llm |StrOutputParser()
    )

def extract_action_items(transcript:str)->str:
    chain = build_chain(
         "You are an expert meeting analyst. From the meeting transcript, "
        "extract all action items. For each provide:\n"
        "- Task description\n"
        "- Owner (who is responsible)\n"
        "- Deadline (if mentioned, else write 'Not specified')\n\n"
        "Format as a numbered list. If none found say 'No action items found.'"
    )

    return chain.invoke(transcript)


def extract_key_decisions(transcript: str) -> str:
    chain = build_chain(
        "You are an expert meeting analyst. From the meeting transcript, "
        "extract all key decisions made. Format as a numbered list. "
        "If none found say 'No key decisions found.'"
    )
    return chain.invoke(transcript)


def extract_questions(transcript: str) -> str:
    chain = build_chain(
        "From the meeting transcript, extract all unresolved questions "
        "or topics needing follow-up. Format as a numbered list. "
        "If none found say 'No open questions found.'"
    )
    return chain.invoke(transcript)


def generate_suggested_queries(transcript: str, language: str) -> list:
    lang_instruction = "in Hinglish (Hindi written in Roman/Latin script)" if language == "hinglish" else "in English"
    prompt = (
        f"You are a highly precise meeting assistant. Analyze the provided meeting/video transcript and generate exactly 3 suggested questions.\n\n"
        f"CRITICAL REQUIREMENTS:\n"
        f"1. Each question MUST be directly and fully answerable using ONLY the explicit facts, statements, or events mentioned in the transcript.\n"
        f"2. DO NOT generate broad, general, or speculative questions (e.g., do not ask 'how to build custom GPTs' if the transcript only briefly mentions a tool's name; do not ask for general comparisons unless they are explicitly compared in the text).\n"
        f"3. Make the questions highly specific to the actual content, speakers, tasks, timelines, tools, or decisions described in this transcript.\n"
        f"4. The questions must be written {lang_instruction}.\n"
        f"5. Keep each question short, natural, and under 15 words.\n\n"
        f"Format the output strictly as a bulleted list of 3 items (using '-' prefix), with no extra text, introductions, or explanations."
    )
    chain = build_chain(prompt)
    response = chain.invoke(transcript)
    
    queries = []
    for line in response.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        cleaned = line
        # Clean up common list markers
        for prefix in ['-', '*', '1.', '2.', '3.']:
            if cleaned.startswith(prefix):
                cleaned = cleaned[len(prefix):].strip()
                break
        cleaned = cleaned.strip('"\'')
        if cleaned:
            queries.append(cleaned)
            
    # Fallback to default questions if parsing fails or returns too few
    if len(queries) < 3:
        if language == "hinglish":
            return [
                "Meeting key decisions kya hain?",
                "Action items kya hain?",
                "Open questions kya hain?"
            ][:3]
        else:
            return [
                "What are the key decisions of the meeting?",
                "What are the action items?",
                "What are the open questions?"
            ][:3]
    return queries[:3]