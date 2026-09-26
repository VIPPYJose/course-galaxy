"""Static dev server for the galaxy page (no caching, so edits show up on reload).

    python3 serve.py            # http://localhost:5173
    python3 serve.py 8080
    PORT=8080 python3 serve.py
"""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('PORT', 5173))
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web')


class NoCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.webp': 'image/webp', '.json': 'application/json'}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    print(f'Course Galaxy on http://localhost:{PORT}')
    http.server.ThreadingHTTPServer(('', PORT), NoCache).serve_forever()
