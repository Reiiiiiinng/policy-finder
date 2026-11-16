"""Run the normal isolated preview with two catalogue recommendations for review."""

from preview_regression import BrowserModel, main


if __name__ == "__main__":
    main(lambda: BrowserModel(["fs_med_001", "fs_med_002", "fs_med_005"]))
