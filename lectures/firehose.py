import websockets
import asyncio
import json
import openai
import dotenv

uri = "wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post"

PROMPT = """
You are a poetry detector. Given the text of a social media
post, determine if it is a poem.

Respond with JSON please:
{
  "is_poem": true/false,
  "confidence": 0.0-1.0,
  "explanation": "brief reason (<100 words)"
}

The post text is:
%s
"""

dotenv.load_dotenv()
client = openai.AsyncOpenAI()

async def listen_to_websocket():
  async with websockets.connect(uri) as websocket:
    while True:
      try:
        message = await websocket.recv()
        msgjson = json.loads(message)
        msgtext = msgjson["commit"]["record"]["text"]
        response = await client.chat.completions.create(
          model="gpt-4o-mini",
          messages=[
            { "role": "user", "content": PROMPT % msgtext }
          ],
          response_format={"type": "json_object"},
          max_tokens=150
        )
        result = json.loads(response.choices[0].message.content)
        if result['is_poem']:
          print(msgtext)
          print(result['explanation'])
        else:
          print(result['explanation'])

      except Exception as e:
        print(f"Bad: {e}")


asyncio.run(listen_to_websocket())
