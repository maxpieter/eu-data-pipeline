#!/bin/bash
# Start both frontend and backend for local development

echo "Starting EU Network Graph development environment..."
echo ""

# Check if Python dependencies are installed
python3 -c "import flask, flask_cors, pandas, networkx, dotenv" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "Installing Python dependencies..."
    pip3 install --break-system-packages -r requirements.txt
fi

# Start the Python backend in the background
echo "Starting Python backend on http://localhost:5001"
python3 server.py &
BACKEND_PID=$!

# Wait for backend to start
sleep 2

# Start the Next.js frontend
echo "Starting Next.js frontend on http://localhost:3000"
npm run dev &
FRONTEND_PID=$!

# Handle shutdown
cleanup() {
    echo ""
    echo "Shutting down..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
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
