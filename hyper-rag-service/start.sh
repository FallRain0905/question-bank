#!/bin/bash
# Start Hyper-RAG microservice
cd "$(dirname "$0")"
pip install -r requirements.txt
python main.py
