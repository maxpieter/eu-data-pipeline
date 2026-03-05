#!/bin/bash
# Start both frontend and backend for local development

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_PYTHON="$SCRIPT_DIR/venv/bin/python"

echo "Starting EU Network Graph development environment..."
echo ""

# Use venv python, fall back to system python3
if [ ! -x "$VENV_PYTHON" ]; then
    echo "Warning: venv not found, using system python3"
    VENV_PYTHON=python3
fi

# Check if Python dependencies are installed
$VENV_PYTHON -c "import flask, flask_cors, pandas, networkx" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "Installing Python dependencies..."
    $VENV_PYTHON -m pip install -r requirements.txt
fi

# Kill any leftover processes on our ports
lsof -ti :5001 | xargs kill -9 2>/dev/null
lsof -ti :3000 | xargs kill -9 2>/dev/null
sleep 1

# Start the Python backend in the background
echo "Starting Python backend on http://localhost:5001"
$VENV_PYTHON server.py &
BACKEND_PID=$!

# Wait for backend to start
sleep 2

# Start the Next.js frontend
echo "Starting Next.js frontend on http://localhost:3000"
npm run dev &
FRONTEND_PID=$!

# Handle shutdown — kill process groups so Flask debug worker children die too
cleanup() {
    echo ""
    echo "Shutting down..."
    kill -- -$BACKEND_PID 2>/dev/null || kill $BACKEND_PID 2>/dev/null
    kill -- -$FRONTEND_PID 2>/dev/null || kill $FRONTEND_PID 2>/dev/null
    # Belt and suspenders: kill anything still on our ports
    lsof -ti :5001 | xargs kill -9 2>/dev/null
    lsof -ti :3000 | xargs kill -9 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

echo ""
echo "=========================================="
echo "  Backend:  http://localhost:5001/api/graph"
echo "  Frontend: http://localhost:3000"
echo "=========================================="
echo ""
echo "Press Ctrl+C to stop both servers"
echo ""

# Wait for either process to exit
wait
