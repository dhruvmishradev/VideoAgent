import os 
import sys
from unittest.mock import MagicMock

# Prevent cygrpc DLL load failure under Windows Application Control policies by mocking the OTLP trace exporter
sys.modules['opentelemetry.exporter.otlp.proto.grpc.trace_exporter'] = MagicMock()

from langchain_chroma import Chroma 
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document

CHROMA_DIR = "vector_db"
COLLECTION_NAME = "meeting_transcript"
EMBEDDING_MODEL  = "all-MiniLM-L6-v2"

def get_embeddings():
    return HuggingFaceEmbeddings(
        model_name = EMBEDDING_MODEL,
        model_kwargs = {"device" : 'cpu'}
    )

def build_vector_store(transcript : str)->Chroma:
    print("Building vector Store")

    # Clear existing vector database records to avoid mixing transcripts of different videos
    import shutil
    if os.path.exists(CHROMA_DIR):
        try:
            shutil.rmtree(CHROMA_DIR)
        except Exception:
            try:
                embeddings = get_embeddings()
                Chroma(
                    collection_name=COLLECTION_NAME,
                    embedding_function=embeddings,
                    persist_directory=CHROMA_DIR
                ).delete_collection()
            except Exception as e:
                print(f"Error resetting collection: {e}")

    splitter = RecursiveCharacterTextSplitter(
        chunk_size = 1000,
        chunk_overlap = 150
    )
    chunks = splitter.split_text(transcript)

    docs = [
        Document(page_content=chunk, metadata = {'chunk_index' : i})
        for i,chunk in enumerate(chunks)
    ]

    embeddings = get_embeddings()
    vector_store = Chroma.from_documents(
        documents= docs,
        embedding=embeddings,
        collection_name=COLLECTION_NAME,
        persist_directory=CHROMA_DIR
    )

    return vector_store



def load_vector_store() ->Chroma:
    embeddings = get_embeddings()
    vector_store = Chroma(
        collection_name=COLLECTION_NAME,
        embedding_function= embeddings,
        persist_directory=CHROMA_DIR
    )

    return vector_store

def get_retriever(vector_store : Chroma, k :int = 4):
    return vector_store.as_retriever(
        search_type = 'similarity',
        search_kwargs = {"k":k}
    )

