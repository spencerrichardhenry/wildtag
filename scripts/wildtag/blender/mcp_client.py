"""Call the official Blender MCP server through the standard MCP client SDK.

Usage: python mcp_client.py scene | list | code <python-file> | eval <python-code>
The project-local environment is described in the asset authoring documentation.
"""
import asyncio
import json
import os
import sys
from pathlib import Path
from datetime import timedelta
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[3]
PROMPT = 'Overhaul every Wildtag game asset in Blender MCP, retaining the artistic direction with higher fidelity, and create natural deposits, extractors, and creature carts.'

async def main():
    env = dict(os.environ)
    env.update({'BLENDER_HOST': '127.0.0.1', 'BLENDER_PORT': '9876', 'DISABLE_TELEMETRY': '1', 'XDG_CONFIG_HOME': str(ROOT / '.codex-drafts/blender-mcp/config'), 'XDG_DATA_HOME': str(ROOT / '.codex-drafts/blender-mcp/data')})
    params = StdioServerParameters(command=str(ROOT / '.codex-drafts/blender-mcp/venv/bin/blender-mcp'), env=env)
    async with stdio_client(params, errlog=(ROOT / '.codex-drafts/blender-mcp/client.log').open('a')) as streams:
        async with ClientSession(*streams, read_timeout_seconds=timedelta(seconds=240)) as session:
            await session.initialize()
            mode = sys.argv[1] if len(sys.argv) > 1 else 'scene'
            if mode == 'list':
                result = await session.list_tools()
                print(json.dumps([{'name': t.name, 'description': t.description} for t in result.tools], indent=2)); return
            if mode == 'scene':
                result = await session.call_tool('get_scene_info', {'user_prompt': PROMPT})
            else:
                code = Path(sys.argv[2]).read_text() if mode == 'code' else sys.argv[2]
                result = await session.call_tool('execute_blender_code', {'code': code, 'user_prompt': PROMPT})
            data = result.model_dump(mode='json')
            for item in data.get('content', []):
                if item.get('type') == 'text': print(item['text'])
            if result.isError: raise SystemExit(1)

asyncio.run(main())
