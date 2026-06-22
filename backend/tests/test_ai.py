from app.services.ai import _rule_based_diagnosis, build_prompt


def test_ai_prompt_redacts_secrets() -> None:
    prompt = build_prompt(
        {
            "asset": {"metadata": {"access_key_secret": "abcDEF1234567890", "private_key": "-----BEGIN PRIVATE KEY-----abc-----END PRIVATE KEY-----"}},
            "alert": {"message": "token=secretToken123456"},
        },
        "zh",
    )

    assert "abcDEF1234567890" not in prompt
    assert "secretToken123456" not in prompt
    assert "BEGIN PRIVATE KEY" not in prompt


def test_rule_based_diagnosis_localizes_to_chinese() -> None:
    diagnosis = _rule_based_diagnosis(
        {
            "alert": {"title": "演示 API 健康检查失败", "failure_count": 2},
            "asset": {"metadata": {"disk_used_percent": 91}},
        },
        "zh",
    )

    assert diagnosis["summary"].startswith("演示 API 健康检查失败")
    assert "AccessKey" not in diagnosis["summary"]
    assert "磁盘使用率" in diagnosis["root_causes"][0]
    assert diagnosis["commands"][0]["reason"] == "检查 Linux 服务器磁盘使用率。"


def test_rule_based_diagnosis_keeps_english() -> None:
    diagnosis = _rule_based_diagnosis(
        {
            "alert": {"title": "API health is failing", "failure_count": 2},
            "asset": {"metadata": {"disk_used_percent": 91}},
        },
        "en",
    )

    assert "manual investigation" in diagnosis["summary"]
    assert "Disk usage" in diagnosis["root_causes"][0]
