from pathlib import Path


def test_result():
    result_path = Path("/app/result.txt")
    assert result_path.exists(), f"{result_path} does not exist"
    assert result_path.read_text().strip() == "gamma-done"
