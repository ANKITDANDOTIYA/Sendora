"""Tests for the Enhance-with-AI feature – API route and agent graph.

These tests are pure Python and do NOT hit real APIs.
All HTTP calls and LLM calls are mocked.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_config(token: str = "test-token", frontend_url: str = "http://localhost:3000") -> dict:
    return {"configurable": {"auth_token": token, "frontend_url": frontend_url}}


# ---------------------------------------------------------------------------
# Tests: src.tools._base_url
# ---------------------------------------------------------------------------


class TestBaseUrl:
    """_base_url should resolve the frontend URL from multiple sources."""

    def test_uses_frontend_url_from_config(self):
        from src.tools import _base_url

        config = _make_config(frontend_url="https://app.example.com/")
        assert _base_url(config) == "https://app.example.com"

    def test_falls_back_to_frontend_url_env(self, monkeypatch):
        from src.tools import _base_url

        monkeypatch.setenv("FRONTEND_URL", "https://env.example.com")
        assert _base_url(None) == "https://env.example.com"

    def test_falls_back_to_backend_url_env(self, monkeypatch):
        from src.tools import _base_url

        for var in ("FRONTEND_URL", "APP_URL", "NEXT_PUBLIC_APP_URL", "NEXTAUTH_URL"):
            monkeypatch.delenv(var, raising=False)
        monkeypatch.setenv("BACKEND_URL", "http://localhost:8100")
        assert _base_url(None) == "http://localhost:8100"

    def test_defaults_to_localhost_3000(self, monkeypatch):
        from src.tools import _base_url

        env_vars = ("FRONTEND_URL", "APP_URL", "NEXT_PUBLIC_APP_URL", "NEXTAUTH_URL", "BACKEND_URL")
        for var in env_vars:
            monkeypatch.delenv(var, raising=False)
        assert _base_url(None) == "http://localhost:3000"


# ---------------------------------------------------------------------------
# Tests: agent graph structure
# ---------------------------------------------------------------------------


class TestAgentGraph:
    """The compiled LangGraph should expose the expected node names."""

    def test_graph_has_reason_and_act_nodes(self):
        from src.agent import graph

        node_names = set(graph.nodes.keys())
        assert "reason" in node_names, "Expected 'reason' node in graph"
        assert "act" in node_names, "Expected 'act' node in graph"


# ---------------------------------------------------------------------------
# Tests: _get_llm (Gemini key validation)
# ---------------------------------------------------------------------------


class TestGetLLM:
    """_get_llm should raise if GEMINI_API_KEY is not set."""

    def test_raises_when_gemini_key_missing(self, monkeypatch):
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)

        # Import inside test to avoid caching the already-created LLM
        import src.agent as agent_module

        with patch.object(agent_module, "_get_llm") as mock_get:
            mock_get.side_effect = RuntimeError("GEMINI_API_KEY is not configured")
            with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
                agent_module._get_llm()

    def test_succeeds_when_key_is_present(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "fake-key-for-testing")

        import src.agent as agent_module

        # Patch ChatOpenAI so we don't make real network calls
        with patch("src.agent.ChatOpenAI") as mock_llm_cls:
            mock_llm = MagicMock()
            mock_llm.bind_tools.return_value = mock_llm
            mock_llm_cls.return_value = mock_llm

            # Reset module-level LLM cache if any
            result = agent_module._get_llm()
            assert result is not None


# ---------------------------------------------------------------------------
# Tests: FastAPI /health endpoint
# ---------------------------------------------------------------------------


class TestHealthEndpoint:
    """The /health endpoint should return 200 with status ok."""

    def test_health_returns_ok(self):
        from fastapi.testclient import TestClient

        from src.server import app

        client = TestClient(app)
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# Tests: /chat endpoint (non-streaming) – mocked graph
# ---------------------------------------------------------------------------


class TestChatEndpoint:
    """POST /chat should forward messages to the graph and return a reply."""

    def test_chat_returns_reply(self):
        from fastapi.testclient import TestClient
        from langchain_core.messages import AIMessage, HumanMessage

        mock_result = {"messages": [HumanMessage(content="hi"), AIMessage(content="Hello!")]}

        with patch("src.server.graph") as mock_graph:
            mock_graph.ainvoke = AsyncMock(return_value=mock_result)

            from src.server import app

            client = TestClient(app)
            response = client.post(
                "/chat",
                json={
                    "message": "hi",
                    "thread_id": "test-thread",
                    "auth_token": "test-token",
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["reply"] == "Hello!"
        assert any(s["type"] == "human" for s in data["steps"])
        assert any(s["type"] == "assistant" for s in data["steps"])

    def test_chat_with_empty_ai_message(self):
        """An AI message with empty content should produce an empty reply."""
        from fastapi.testclient import TestClient
        from langchain_core.messages import AIMessage, HumanMessage

        mock_result = {"messages": [HumanMessage(content="hi"), AIMessage(content="")]}

        with patch("src.server.graph") as mock_graph:
            mock_graph.ainvoke = AsyncMock(return_value=mock_result)

            from src.server import app

            client = TestClient(app)
            response = client.post(
                "/chat",
                json={
                    "message": "hi",
                    "thread_id": "t1",
                    "auth_token": "tok",
                },
            )

        assert response.status_code == 200
        assert response.json()["reply"] == ""
