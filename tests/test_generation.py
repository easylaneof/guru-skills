import json
from pathlib import Path
import tempfile
import unittest

import httpx

from helpers.generate_assets import _create_task, _poll, _resolve_image_input


class GenerationTests(unittest.TestCase):
    def test_public_url_is_not_uploaded(self):
        with httpx.Client(transport=httpx.MockTransport(lambda request: self.fail('Unexpected request'))) as client:
            self.assertEqual(_resolve_image_input('https://example.com/photo.jpg', client, 'test'), 'https://example.com/photo.jpg')

    def test_local_photo_upload_then_generate_and_download(self):
        requests = []

        def handler(request):
            requests.append(request)
            if request.url.path == '/api/file-stream-upload':
                self.assertIn(b'original-image-content', request.content)
                self.assertIn(b'name="uploadPath"', request.content)
                return httpx.Response(200, json={'code': 200, 'success': True, 'data': {'downloadUrl': 'https://example.com/upload.png'}})
            if request.url.path == '/api/v1/jobs/createTask':
                payload = json.loads(request.content)
                self.assertEqual(payload['input']['image_input'], ['https://example.com/upload.png'])
                self.assertEqual(payload['input']['aspect_ratio'], '9:16')
                self.assertEqual(payload['input']['prompt'], 'Keep the same person')
                return httpx.Response(200, json={'code': 200, 'data': {'taskId': 'test-task'}})
            if request.url.path == '/api/v1/jobs/recordInfo':
                return httpx.Response(200, json={'code': 200, 'data': {'state': 'success', 'resultJson': json.dumps({'resultUrls': ['https://example.com/result.png']})}})
            self.assertEqual(request.url.path, '/result.png')
            self.assertNotIn('Authorization', request.headers)
            return httpx.Response(200, content=b'rendered-image')

        with tempfile.TemporaryDirectory() as folder, httpx.Client(transport=httpx.MockTransport(handler)) as client:
            photo = Path(folder) / 'source.jpg'
            photo.write_bytes(b'original-image-content')
            url = _resolve_image_input(str(photo), client, 'test')
            task = _create_task(client, 'Keep the same person', '9:16', 'nano-banana-pro', 'https://api.kie.ai', 'test', url)
            assert task is not None
            image, _ = _poll(client, task, 'https://api.kie.ai', 'test')
            self.assertEqual(image, b'rendered-image')
            self.assertEqual(len(requests), 4)

    def test_sidecar_prefers_local_photo_over_expired_url(self):
        def handler(request):
            self.assertEqual(request.url.path, '/api/file-stream-upload')
            return httpx.Response(200, json={'code': 200, 'data': {'downloadUrl': 'https://example.com/fresh.png'}})
        with tempfile.TemporaryDirectory() as folder, httpx.Client(transport=httpx.MockTransport(handler)) as client:
            photo = Path(folder) / 'source.png'
            photo.write_bytes(b'image')
            sidecar = photo.with_suffix('.json')
            sidecar.write_text(json.dumps({'filename': 'source.png', 'cdn_url': 'https://example.com/expired.png'}))
            self.assertEqual(_resolve_image_input(str(sidecar), client, 'test'), 'https://example.com/fresh.png')

    def test_api_error_in_http_200_is_reported(self):
        with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json={'code': 401, 'msg': 'Invalid key'}))) as client:
            with self.assertRaisesRegex(RuntimeError, 'Invalid key'):
                _poll(client, 'task', 'https://api.kie.ai', 'test')
            with self.assertRaisesRegex(RuntimeError, 'Invalid key'):
                _create_task(client, 'photo', '1:1', 'nano-banana-pro', 'https://api.kie.ai', 'test')

    def test_upload_error_never_creates_generation(self):
        requests = []
        def handler(request):
            requests.append(request)
            return httpx.Response(200, json={'code': 400, 'msg': 'Bad upload'})
        with tempfile.TemporaryDirectory() as folder, httpx.Client(transport=httpx.MockTransport(handler)) as client:
            photo = Path(folder) / 'source.jpg'
            photo.write_bytes(b'image')
            with self.assertRaisesRegex(RuntimeError, 'Bad upload'):
                _resolve_image_input(str(photo), client, 'test')
            self.assertEqual(len(requests), 1)

    def test_missing_source_does_not_make_network_request(self):
        with httpx.Client(transport=httpx.MockTransport(lambda request: self.fail('Unexpected request'))) as client:
            with self.assertRaises(FileNotFoundError):
                _resolve_image_input('/nonexistent/photo.jpg', client, 'test')


if __name__ == '__main__':
    unittest.main()
