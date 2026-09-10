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
PROMPT = os.environ.get('BLENDER_TASK_PROMPT', 'Author and refine original Wildtag game models through Blender MCP, preserving the cozy art direction and efficient, high fidelity geometry.')

async def main():
    env = dict(os.environ)
    env.update({'BLENDER_HOST': '127.0.0.1', 'BLENDER_PORT': '9876', 'DISABLE_TELEMETRY': '1', 'XDG_CONFIG_HOME': str(ROOT / '.codex-drafts/blender-mcp/config'), 'XDG_DATA_HOME': str(ROOT / '.codex-drafts/blender-mcp/data')})
    params = StdioServerParameters(command=str(ROOT / '.codex-drafts/blender-mcp/venv/bin/blender-mcp'), env=env)
    async with stdio_client(params, errlog=(ROOT / '.codex-drafts/blender-mcp/client.log').open('a')) as streams:
        async with ClientSession(*streams, read_timeout_seconds=timedelta(seconds=int(os.environ.get('BLENDER_TIMEOUT_SECONDS', '240')))) as session:
            await session.initialize()
            mode = sys.argv[1] if len(sys.argv) > 1 else 'scene'
            if mode == 'list':
                result = await session.list_tools()
                print(json.dumps([{'name': t.name, 'description': t.description} for t in result.tools], indent=2)); return
            if mode == 'scene':
                result = await session.call_tool('get_scene_info', {'user_prompt': PROMPT})
            else:
                code = ('__file__ = '+repr(str(Path(sys.argv[2]).resolve()))+'\n'+Path(sys.argv[2]).read_text()) if mode == 'code' else sys.argv[2]
                result = await session.call_tool('execute_blender_code', {'code': code, 'user_prompt': PROMPT})
            data = result.model_dump(mode='json')
            for item in data.get('content', []):
                if item.get('type') == 'text': print(item['text'])
            # The bridge can return a textual error with isError=false (for
            # example its socket timing out while Blender continues exporting).
            if result.isError or any(item.get('type') == 'text' and item.get('text', '').startswith('Error executing code:') for item in data.get('content', [])):
                raise SystemExit(1)

asyncio.run(main())
