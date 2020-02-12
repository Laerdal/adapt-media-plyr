// embryonic handling of audio descriptions for video
// To use Web Speech API:
// var foo = AudioDescriptor(videoElement, true);
// to inject description cues into the specified element:
// var bar = AudioDescriptor(videoElement, false, outputElementId);
/*global SpeechSynthesisUtterance*/
var AudioDescriptor = function (mediaElement, useSpeech, outputElementId) {
    var descriptionTracks = [];  // Array<HTMLTrackElement>
    var descriptionsTrack;       // HTMLTrackElement
    var currentCue;              // TextTrackCue
    var synth = window.speechSynthesis;
    var speechPitch = 1;
    var speechRate = 1;
    var audioDesc = document.getElementById(outputElementId);
    var setTrack = function (which) {
        if (which < 0 || which > descriptionTracks.length) {
            return;
        }
        descriptionsTrack = descriptionTracks[which];
    };
    var getCurrentCueText = function () {
        var activeCues = Array.from(descriptionsTrack.activeCues);
        var theCue;
        if (activeCues.length < 1) {
            currentCue = null;
            return;
        }
        theCue = activeCues[0];
        if (theCue === currentCue) {
            return ""; // already announced it
        }
        currentCue = theCue;
        return currentCue.text;
    };
    var speak = function (str) {
        var utterThis = new SpeechSynthesisUtterance(str);
        utterThis.pitch = speechPitch;
        utterThis.rate = speechRate;
        synth.speak(utterThis);
        // pause & add event listener to resume when speech done.
    };
    var cueChanged = function () {
        var cueText = getCurrentCueText();
        if (!cueText) {
            return;
        }
        if (cueText.length < 1) {
            return;
        }
		if (useSpeech) {
			speak(cueText);
		}
		if (audioDesc) {
			audioDesc.textContent = cueText;
		}
    };
    if (!mediaElement) {
        return;
    }
    if (mediaElement.nodeName !== "VIDEO") {
        return;
    }
    Array.from(mediaElement.textTracks).forEach(function (t) {
        if (t.kind === "descriptions") {
            descriptionTracks.push(t);
        }
    });
    if (descriptionTracks.length < 1) {
        return;
    }
    setTrack(0);
    if (!descriptionsTrack) {
        return;
    }
    descriptionsTrack.addEventListener("cuechange", cueChanged, false);
    return {"setTrack": setTrack, "getCurrentCueText": getCurrentCueText};
};