from pathlib import Path


def test_total():
    total_path = Path("/app/total.txt")
    assert total_path.exists(), f"{total_path} does not exist"
    assert total_path.read_text().strip() == "15"
