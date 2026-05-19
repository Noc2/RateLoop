// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SubmissionMediaValidator
/// @notice Stateless helper for Curyo question media validation.
/// @dev Kept outside ContentRegistry to avoid bloating the upgradeable registry runtime.
contract SubmissionMediaValidator {
    uint256 public constant MAX_IMAGE_URLS = 4;
    uint256 public constant MAX_URL_LENGTH = 2048;
    uint256 internal constant YOUTUBE_VIDEO_ID_LENGTH = 11;

    function validateSingleMediaUrl(string calldata url) external pure {
        require(_isValidSubmissionUrl(url), "Invalid URL");
        require(_isSupportedMediaUrl(url), "Invalid media URL");
    }

    function validateContextUrl(string calldata url) external pure {
        require(_isValidSubmissionUrl(url), "Invalid URL");
    }

    function validateMediaSet(string[] calldata imageUrls, string calldata videoUrl) external pure {
        _validateMediaSet(imageUrls, videoUrl, true);
    }

    function validateOptionalMediaSet(string[] calldata imageUrls, string calldata videoUrl) external pure {
        _validateMediaSet(imageUrls, videoUrl, false);
    }

    function isSupportedVideoUrl(string calldata url) external pure returns (bool) {
        return _isSupportedVideoUrl(url);
    }

    function _validateMediaSet(string[] calldata imageUrls, string calldata videoUrl, bool requireMedia) internal pure {
        bool hasVideo = bytes(videoUrl).length != 0;

        if (hasVideo) {
            require(imageUrls.length == 0, "Choose images or video");
            require(_isValidSubmissionUrl(videoUrl), "Invalid URL");
            require(_isSupportedVideoUrl(videoUrl), "Invalid media URL");
            return;
        }

        if (requireMedia) {
            require(imageUrls.length > 0, "Media required");
        }
        require(imageUrls.length <= MAX_IMAGE_URLS, "Too many images");

        for (uint256 i = 0; i < imageUrls.length; i++) {
            require(_isValidSubmissionUrl(imageUrls[i]), "Invalid URL");
            require(_isSupportedImageUrl(imageUrls[i]), "Invalid media URL");
        }
    }

    function _isSupportedMediaUrl(string memory url) internal pure returns (bool) {
        return _isSupportedImageUrl(url) || _isSupportedVideoUrl(url);
    }

    function _isSupportedImageUrl(string memory url) internal pure returns (bool) {
        return _hasUploadedImagePath(url, "https://www.rateloop.xyz/api/attachments/images/att_")
            || _hasUploadedImagePath(url, "https://rateloop.xyz/api/attachments/images/att_")
            || _hasUploadedImagePath(url, "https://www.curyo.xyz/api/attachments/images/att_")
            || _hasUploadedImagePath(url, "https://curyo.xyz/api/attachments/images/att_");
    }

    function _isSupportedVideoUrl(string memory url) internal pure returns (bool) {
        if (_hasValidYoutubePathId(url, "https://youtu.be/")) return true;
        if (_hasValidYoutubePathId(url, "https://www.youtube.com/embed/")) return true;
        if (_hasValidYoutubeWatchId(url, "https://youtube.com/watch?")) return true;
        if (_hasValidYoutubeWatchId(url, "https://www.youtube.com/watch?")) return true;
        if (_hasValidYoutubeWatchId(url, "https://m.youtube.com/watch?")) return true;
        return false;
    }

    function _isValidSubmissionUrl(string memory url) internal pure returns (bool) {
        bytes memory urlBytes = bytes(url);
        bytes memory prefix = bytes("https://");
        if (urlBytes.length <= prefix.length || urlBytes.length > MAX_URL_LENGTH) {
            return false;
        }

        for (uint256 i = 0; i < prefix.length; i++) {
            if (urlBytes[i] != prefix[i]) {
                return false;
            }
        }

        // Scan the host segment (between scheme and first path/query/fragment delimiter).
        // Reject host-confusion characters that browsers parse permissively but that
        // mask the effective host: '@' splits userinfo, '\' is normalized to '/',
        // and '%' allows percent-encoded host obfuscation.
        bool inHost = true;
        uint256 hostLength;
        for (uint256 i = prefix.length; i < urlBytes.length; i++) {
            bytes1 char = urlBytes[i];
            if (char < 0x21 || char > 0x7E) return false;
            if (!_isSafeSubmissionUrlChar(char)) return false;
            if (char == "\\" || char == "@") return false;
            if (char == "%") {
                if (inHost) return false;
                if (i + 2 >= urlBytes.length || !_isHexByte(urlBytes[i + 1]) || !_isHexByte(urlBytes[i + 2])) {
                    return false;
                }
                unchecked {
                    i += 2;
                }
                continue;
            }
            if (inHost) {
                if (char == "/" || char == "?" || char == "#") {
                    if (hostLength == 0) return false;
                    inHost = false;
                } else {
                    unchecked {
                        ++hostLength;
                    }
                }
            }
        }

        return hostLength > 0;
    }

    function _isSafeSubmissionUrlChar(bytes1 char) private pure returns (bool) {
        if (char >= "0" && char <= "9") return true;
        if (char >= "A" && char <= "Z") return true;
        if (char >= "a" && char <= "z") return true;
        return char == "-" || char == "." || char == "_" || char == "~" || char == ":" || char == "/" || char == "?"
            || char == "#" || char == "%" || char == "!" || char == "$" || char == "&" || char == "(" || char == ")"
            || char == "*" || char == "+" || char == "," || char == ";" || char == "=";
    }

    function _isHexByte(bytes1 char) private pure returns (bool) {
        return (char >= "0" && char <= "9") || (char >= "A" && char <= "F") || (char >= "a" && char <= "f");
    }

    function _hasUploadedImagePath(string memory value, string memory prefix) internal pure returns (bool) {
        bytes memory valueBytes = bytes(value);
        bytes memory prefixBytes = bytes(prefix);
        bytes memory suffixBytes = bytes(".webp");

        if (valueBytes.length < prefixBytes.length + 16 + suffixBytes.length) return false;
        if (!_hasPrefix(value, prefix)) return false;

        uint256 end = valueBytes.length;
        uint256 suffixOffset = end - suffixBytes.length;
        for (uint256 i = 0; i < suffixBytes.length; i++) {
            if (valueBytes[suffixOffset + i] != suffixBytes[i]) return false;
        }

        uint256 idStart = prefixBytes.length;
        uint256 idLength = suffixOffset - idStart;
        if (idLength < 16 || idLength > 80) return false;

        for (uint256 i = idStart; i < suffixOffset; i++) {
            if (!_isAttachmentIdByte(valueBytes[i])) return false;
        }

        return true;
    }

    function _hasPrefix(string memory value, string memory prefix) internal pure returns (bool) {
        bytes memory valueBytes = bytes(value);
        bytes memory prefixBytes = bytes(prefix);
        if (valueBytes.length < prefixBytes.length) return false;

        for (uint256 i = 0; i < prefixBytes.length; i++) {
            if (valueBytes[i] != prefixBytes[i]) return false;
        }
        return true;
    }

    function _hasValidYoutubePathId(string memory value, string memory prefix) internal pure returns (bool) {
        bytes memory valueBytes = bytes(value);
        bytes memory prefixBytes = bytes(prefix);
        if (!_hasPrefix(value, prefix)) return false;

        uint256 idLength;
        for (uint256 i = prefixBytes.length; i < valueBytes.length; i++) {
            bytes1 char = valueBytes[i];
            if (char == "?" || char == "#") break;
            if (char == "/" || !_isYoutubeIdByte(char)) return false;
            unchecked {
                ++idLength;
            }
        }
        return idLength == YOUTUBE_VIDEO_ID_LENGTH;
    }

    function _hasValidYoutubeWatchId(string memory value, string memory prefix) internal pure returns (bool) {
        bytes memory valueBytes = bytes(value);
        bytes memory prefixBytes = bytes(prefix);
        if (!_hasPrefix(value, prefix)) return false;

        uint256 i = prefixBytes.length;
        while (i < valueBytes.length) {
            if (valueBytes[i] == "#") return false;
            if (
                (i == prefixBytes.length || valueBytes[i - 1] == "&") && i + 1 < valueBytes.length
                    && valueBytes[i] == "v" && valueBytes[i + 1] == "="
            ) {
                return _hasValidYoutubeQueryValue(valueBytes, i + 2);
            }
            while (i < valueBytes.length && valueBytes[i] != "&" && valueBytes[i] != "#") {
                unchecked {
                    ++i;
                }
            }
            if (i < valueBytes.length && valueBytes[i] == "&") {
                unchecked {
                    ++i;
                }
            }
        }
        return false;
    }

    function _hasValidYoutubeQueryValue(bytes memory valueBytes, uint256 start) internal pure returns (bool) {
        uint256 idLength;
        for (uint256 i = start; i < valueBytes.length; i++) {
            bytes1 char = valueBytes[i];
            if (char == "&" || char == "#") break;
            if (!_isYoutubeIdByte(char)) return false;
            unchecked {
                ++idLength;
            }
        }
        return idLength == YOUTUBE_VIDEO_ID_LENGTH;
    }

    function _isYoutubeIdByte(bytes1 char) internal pure returns (bool) {
        return (char >= 0x30 && char <= 0x39) || (char >= 0x41 && char <= 0x5A) || (char >= 0x61 && char <= 0x7A)
            || char == "_" || char == "-";
    }

    function _isAttachmentIdByte(bytes1 char) internal pure returns (bool) {
        return (char >= 0x30 && char <= 0x39) || (char >= 0x41 && char <= 0x5A) || (char >= 0x61 && char <= 0x7A)
            || char == "_" || char == "-";
    }
}
