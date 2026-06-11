// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/// @title SubmissionMediaValidator
/// @notice Helper for RateLoop question media validation and canonical anchor emission.
/// @dev Kept outside ContentRegistry to avoid bloating the upgradeable registry runtime.
contract SubmissionMediaValidator {
    uint256 public constant MAX_IMAGE_URLS = 4;
    uint256 public constant MAX_URL_LENGTH = 2048;
    uint256 internal constant MAX_QUESTION_LENGTH = 120;
    uint256 internal constant MAX_TAGS_LENGTH = 256;
    uint256 internal constant YOUTUBE_VIDEO_ID_LENGTH = 11;

    error EmitterAlreadyInitialized();
    error InvalidEmitter();
    error UnauthorizedEmitter();

    address public authorizedEmitter;

    event QuestionContentAnchored(
        uint256 indexed contentId,
        uint8 indexed mediaType,
        uint256 mediaIndex,
        string url,
        bytes32 questionMetadataHash,
        bytes32 resultSpecHash
    );

    function initializeEmitter(address emitter) external {
        if (authorizedEmitter != address(0)) revert EmitterAlreadyInitialized();
        if (emitter == address(0) || msg.sender != emitter) revert InvalidEmitter();
        authorizedEmitter = emitter;
    }

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

    function validateContextSubmission(
        string calldata contextUrl,
        string[] calldata imageUrls,
        string calldata videoUrl,
        string calldata title,
        string calldata tags,
        bool gated
    ) external pure {
        bool hasContextUrl = bytes(contextUrl).length != 0;
        if (gated) {
            require(!hasContextUrl && imageUrls.length == 0 && bytes(videoUrl).length == 0, "Gated public refs");
        } else {
            require(hasContextUrl || imageUrls.length > 0 || bytes(videoUrl).length != 0, "Context or media required");
        }
        if (hasContextUrl) {
            require(_isValidSubmissionUrl(contextUrl), "Invalid URL");
        }
        _validateMediaSet(imageUrls, videoUrl, false);
        require(bytes(title).length > 0, "Question required");
        require(bytes(title).length <= MAX_QUESTION_LENGTH, "Question too long");
        require(bytes(tags).length > 0, "Tags required");
        require(bytes(tags).length <= MAX_TAGS_LENGTH, "Tags too long");
    }

    function validateSubmissionDetails(string calldata detailsUrl, bytes32 detailsHash, bool gated) external pure {
        if (bytes(detailsUrl).length != 0) {
            require(detailsHash != bytes32(0), "Details hash required");
            require(!gated, "Gated public refs");
            require(_isValidSubmissionUrl(detailsUrl), "Invalid URL");
        } else if (gated) {
            require(detailsHash != bytes32(0), "Gated details hash required");
        } else {
            require(detailsHash == bytes32(0), "Details URL required");
        }
    }

    function isSupportedVideoUrl(string calldata url) external pure returns (bool) {
        return _isSupportedVideoUrl(url);
    }

    function emitQuestionContentAnchored(
        uint256 contentId,
        string[] calldata imageUrls,
        string calldata videoUrl,
        bytes32 questionMetadataHash,
        bytes32 resultSpecHash
    ) external {
        if (msg.sender != authorizedEmitter) revert UnauthorizedEmitter();
        if (bytes(videoUrl).length != 0) {
            emit QuestionContentAnchored(contentId, 2, 0, videoUrl, questionMetadataHash, resultSpecHash);
            return;
        }
        if (imageUrls.length == 0) {
            emit QuestionContentAnchored(contentId, 0, 0, "", questionMetadataHash, resultSpecHash);
            return;
        }
        for (uint256 i = 0; i < imageUrls.length; i++) {
            emit QuestionContentAnchored(contentId, 1, i, imageUrls[i], questionMetadataHash, resultSpecHash);
        }
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
            require(_isValidMediaReferenceUrl(imageUrls[i]), "Invalid URL");
            require(_isSupportedImageUrl(imageUrls[i]), "Invalid media URL");
        }
    }

    function _isSupportedMediaUrl(string memory url) internal pure returns (bool) {
        return _isSupportedImageUrl(url) || _isSupportedVideoUrl(url);
    }

    function _isSupportedImageUrl(string memory url) internal pure returns (bool) {
        if (_isValidContentAddressedUri(url)) return true;
        return _hasSha256AnchoredHttpsUrl(url);
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

    function _isValidMediaReferenceUrl(string memory url) internal pure returns (bool) {
        return _isValidSubmissionUrl(url) || _isValidContentAddressedUri(url);
    }

    function _isValidContentAddressedUri(string memory url) internal pure returns (bool) {
        bytes memory urlBytes = bytes(url);
        bool ipfs = _hasPrefix(url, "ipfs://");
        bool ar = _hasPrefix(url, "ar://");
        if (!ipfs && !ar) return false;
        if (urlBytes.length > MAX_URL_LENGTH) return false;

        uint256 prefixLength = ipfs ? bytes("ipfs://").length : bytes("ar://").length;
        if (urlBytes.length <= prefixLength) return false;
        for (uint256 i = prefixLength; i < urlBytes.length; i++) {
            bytes1 char = urlBytes[i];
            if (char < 0x21 || char > 0x7E) return false;
            if (!_isSafeSubmissionUrlChar(char)) return false;
        }
        return true;
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

    function _hasSha256AnchoredHttpsUrl(string memory value) internal pure returns (bool) {
        if (!_isValidSubmissionUrl(value)) return false;

        bytes memory valueBytes = bytes(value);
        bytes memory marker = bytes("#sha256=0x");
        uint256 digestLength = 64;
        if (valueBytes.length < marker.length + digestLength) return false;

        uint256 markerOffset = valueBytes.length - marker.length - digestLength;
        for (uint256 i = 0; i < marker.length; i++) {
            if (valueBytes[markerOffset + i] != marker[i]) return false;
        }
        for (uint256 i = markerOffset + marker.length; i < valueBytes.length; i++) {
            if (!_isHexByte(valueBytes[i])) return false;
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
}
