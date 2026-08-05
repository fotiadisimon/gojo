from backend.utils import extract_json, safe_str


class TestExtractJson:
    def test_pure_json(self):
        assert extract_json('{"a": 1}') == {'a': 1}

    def test_markdown_wrapped(self):
        assert extract_json('```json\n{"a": 1}\n```') == {'a': 1}

    def test_markdown_no_lang(self):
        assert extract_json('```\n{"a": 1}\n```') == {'a': 1}

    def test_prose_before_json(self):
        raw = 'Sure! Here\'s the reply:\n{"emotion": "开心", "content": "hi"}'
        parsed = extract_json(raw)
        assert parsed['emotion'] == '开心'

    def test_prose_after_json(self):
        raw = '{"emotion": "平静", "content": "hi"} <- like this'
        parsed = extract_json(raw)
        assert parsed['emotion'] == '平静'

    def test_invalid(self):
        assert extract_json('') is None
        assert extract_json('not json at all!!') is None

    def test_nested(self):
        parsed = extract_json('{"a": {"b": [1, 2]}}')
        assert parsed['a']['b'] == [1, 2]


class TestSafeStr:
    def test_none(self):
        assert safe_str(None) == ''
        assert safe_str(None, 'x') == 'x'

    def test_normal(self):
        assert safe_str('  hi  ') == 'hi'

    def test_num(self):
        assert safe_str(42) == '42'
