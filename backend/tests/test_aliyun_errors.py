from app.services.aliyun import SyncWarning, format_aliyun_error, summarize_aliyun_warnings, warning_messages


def test_signature_errors_become_actionable_messages() -> None:
    message = format_aliyun_error(
        "Error SignatureDoesNotMatch: server StringToSign is [GET&%2F&foo] "
        "server CanonicalRequest is [GET\n/\nAccessKeyId=bad]"
    )

    assert "AccessKey ID" in message
    assert "AccessKey Secret" in message
    assert "StringToSign" not in message
    assert "CanonicalRequest" not in message


def test_permission_errors_become_actionable_messages() -> None:
    message = format_aliyun_error("AccessDenied: NoPermission for DescribeInstances")

    assert "permission denied" in message.lower()
    assert "read-only policies" in message


def test_network_timeouts_become_short_warnings() -> None:
    message = format_aliyun_error(
        "HTTPSConnectionPool(host='ecs.ap-southeast-5.aliyuncs.com', port=443): "
        "Max retries exceeded with url: /?PageNumber=1 (Caused by ConnectTimeoutError('timed out'))"
    )

    assert "regional network issue" in message
    assert "HTTPSConnectionPool" not in message


def test_repeated_signature_warnings_are_collapsed() -> None:
    warnings = [
        SyncWarning("Resource Center", format_aliyun_error("SignatureDoesNotMatch")),
        SyncWarning("ECS regions", f"Falling back to startup region: {format_aliyun_error('IncompleteSignature')}"),
        SyncWarning("OSS", format_aliyun_error("SignatureDoesNotMatch")),
    ]

    messages = warning_messages(warnings)
    summary = summarize_aliyun_warnings(warnings)

    assert len(messages) == 1
    assert summary == messages[0]
    assert "AccessKey ID" in summary
    assert "Resource Center" not in summary
    assert len(summary) < 350
