import os
import json
import asyncio
from dotenv import load_dotenv
from pydantic import BaseModel
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# Load environment variables before importing core modules
load_dotenv()

# Import modules from original pipeline structure
from utils.audio_processor import process_input
from core.transcriber import transcribe_all
from core.summarizer import summarize, generate_title
from core.extractor import extract_action_items, extract_key_decisions, extract_questions, generate_suggested_queries
from core.rag_engine import build_rag_chain, ask_question, get_llm, format_docs
from core.vector_store import load_vector_store, get_retriever

# Redefine load_rag_chain to fix the missing vector_store parameter bug in core/rag_engine.py
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnablePassthrough, RunnableLambda
from langchain_core.output_parsers import StrOutputParser

# --- FastAPI Setup ---

app = FastAPI(title="Video Agent Backend API")

# Configure CORS to allow frontend connections
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DOWNLOAD_DIR = "downloades"
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

class ChatRequest(BaseModel):
    question: str

def server_load_rag_chain():
    vector_store = load_vector_store()
    retriever = get_retriever(vector_store)
    llm = get_llm()
    prompt = ChatPromptTemplate.from_messages([
        (
            "system",
            """You are an expert meeting assistant. Answer the user's question 
based ONLY on the meeting transcript context provided below.

If the answer is not found in the context, say: 
"I could not find this information in the meeting transcript."

Always be concise and precise. If quoting someone, mention it clearly.

Context from meeting transcript:
{context}""",
        ),
        ("human", "{question}"),
    ])

    rag_chain = (
        {
            "context":  retriever | RunnableLambda(format_docs),
            "question": RunnablePassthrough(),
        }
        | prompt
        | llm
        | StrOutputParser()
    )
    return rag_chain

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    try:
        safe_name = os.path.basename(file.filename)
        file_path = os.path.join(DOWNLOAD_DIR, safe_name)
        with open(file_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
        return {"filepath": os.path.abspath(file_path), "filename": safe_name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/process-stream")
async def process_stream(source: str, language: str = "english"):
    from starlette.concurrency import run_in_threadpool

    async def event_generator():
        try:
            # Step 1: Slicing audio spectrum
            yield f"data: {json.dumps({'step': 0, 'status': 'active', 'message': 'Slicing audio spectrum...'})}\n\n"
            await asyncio.sleep(0.1)
            chunks = await run_in_threadpool(process_input, source)
            yield f"data: {json.dumps({'step': 0, 'status': 'completed', 'message': 'Slicing audio spectrum... (Done)'})}\n\n"
            await asyncio.sleep(0.1)

            # Step 2: Generating transcript
            yield f"data: {json.dumps({'step': 1, 'status': 'active', 'message': 'Generating transcript strings...'})}\n\n"
            await asyncio.sleep(0.1)
            transcript = await run_in_threadpool(transcribe_all, chunks, language)
            yield f"data: {json.dumps({'step': 1, 'status': 'completed', 'message': 'Generating transcript strings... (Done)'})}\n\n"
            await asyncio.sleep(0.1)

            # Step 3: Summary and Title
            yield f"data: {json.dumps({'step': 2, 'status': 'active', 'message': 'Compiling summary and descriptors...'})}\n\n"
            await asyncio.sleep(0.1)
            title = await run_in_threadpool(generate_title, transcript)
            summary = await run_in_threadpool(summarize, transcript)
            yield f"data: {json.dumps({'step': 2, 'status': 'completed', 'message': 'Compiling summary and descriptors... (Done)'})}\n\n"
            await asyncio.sleep(0.1)

            # Step 4: Extracting items
            yield f"data: {json.dumps({'step': 3, 'status': 'active', 'message': 'Extracting tasks, decisions, questions...'})}\n\n"
            await asyncio.sleep(0.1)
            action_items = await run_in_threadpool(extract_action_items, transcript)
            decisions = await run_in_threadpool(extract_key_decisions, transcript)
            questions = await run_in_threadpool(extract_questions, transcript)
            suggested_queries = await run_in_threadpool(generate_suggested_queries, transcript, language)
            yield f"data: {json.dumps({'step': 3, 'status': 'completed', 'message': 'Extracting tasks, decisions, questions... (Done)'})}\n\n"
            await asyncio.sleep(0.1)

            # Step 5: Vector RAG matrix
            yield f"data: {json.dumps({'step': 4, 'status': 'active', 'message': 'Constructing RAG vector matrix...'})}\n\n"
            await asyncio.sleep(0.1)
            await run_in_threadpool(build_rag_chain, transcript)
            yield f"data: {json.dumps({'step': 4, 'status': 'completed', 'message': 'Constructing RAG vector matrix... (Done)'})}\n\n"
            await asyncio.sleep(0.1)

            # Return final results
            result = {
                "title": title,
                "transcript": transcript,
                "summary": summary,
                "action_items": action_items,
                "key_decisions": decisions,
                "open_questions": questions,
                "suggested_queries": suggested_queries,
                "source": source,
                "language": language
            }
            yield f"data: {json.dumps({'step': 5, 'status': 'done', 'result': result})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'step': -1, 'status': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.post("/api/chat")
async def chat(req: ChatRequest):
    try:
        chain = server_load_rag_chain()
        answer = ask_question(chain, req.question)
        return {"answer": answer}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- CLI / Local execution pipeline ---

def run_pipeline(source :str, language :str = "english") -> dict:
    print("starting AI Video Assistant")

    chunks = process_input(source)

    transcript = transcribe_all(chunks, language)
    print(f"raw transcription (first 300 characters ) {transcript[:300]}")

    title = generate_title(transcript)

    summary = summarize(transcript)

    action_item = extract_action_items(transcript)

    decisions = extract_key_decisions(transcript)
    questions = extract_questions(transcript)
    
    rag_chain = build_rag_chain(transcript)

    return {
        "title": title,
        "transcript": transcript,
        "summary": summary,
        "action_items": action_item,
        "key_decisions": decisions,
        "open_questions": questions,
        "rag_chain": rag_chain,
    }

if __name__ == "__main__":
    import sys
    # If standard run, start CLI dashboard.
    # Allow starting FastAPI server locally if run with --server argument
    if "--server" in sys.argv:
        import uvicorn
        uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
    else:
        # CLI entry point
        source = input("Enter YouTube URL or local file path: ").strip()
        language = input("Language (english/hinglish): ").strip() or "english"
        result = run_pipeline(source, language)

        print("\n" + "=" * 60)
        print(f"📌 Title: {result['title']}")
        print(f"\n📋 Summary:\n{result['summary']}")
        print(f"\n✅ Action Items:\n{result['action_items']}")
        print(f"\n🔑 Key Decisions:\n{result['key_decisions']}")
        print(f"\n❓ Open Questions:\n{result['open_questions']}")
        print("=" * 60)

        # Phase 2 — Chat with your meeting via RAG
        print("\n💬 Chat with your meeting (type 'exit' to quit)\n")
        rag_chain = result["rag_chain"]
        while True:
            question = input("You: ").strip()
            if question.lower() in ["exit", "quit", "q"]:
                print("👋 Goodbye!")
                break
            if not question:
                continue
            answer = ask_question(rag_chain, question)
            print(f"\n🤖 Assistant: {answer}\n")