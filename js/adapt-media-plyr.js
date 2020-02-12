define([
    'core/js/adapt',
    'core/js/views/componentView',
    'core/js/models/componentModel',
    './plyr-wrapper',
    'libraries/audioDescriptor'
], function(Adapt, ComponentView, ComponentModel, LaerdalMediaPopupView) {

    var MediaView = ComponentView.extend({

        events: {
            "click [data-plyr=transcript]": "onToggleInlineTranscript",
            "click .media-external-transcript-button": "onExternalTranscriptClicked",
            "play .plyr": "onMediaElementPlay",
            "playing .plyr": "onPlyrPlaying",
            "pause .plyr": "onMediaElementPause",
            "ended .plyr": "onMediaElementEnded",
            "seeking .plyr": "onMediaElementSeeking",
            "timeupdate .plyr": "onMediaElementTimeUpdate",
            "ready .plyr": "onMediaElementReady",
            "enterfullscreen .plyr": "onEnterfullscreen",
            "exitfullscreen .plyr": "onExitfullscreen",
            "click .plyr" : "onMediaElementClick"
        },

        className: function() {
            var classes = ComponentView.prototype.className.call(this);
            return classes;
        },

        preRender: function() {
            this.listenTo(Adapt, {
                'device:resize': this.onScreenSizeChanged,
                'device:changed': this.onDeviceChanged,
                'media:stop': this.onMediaStop
            });

            // set initial player state attributes
            this.model.set({
                '_isMediaEnded': false,
                '_isMediaPlaying': false
            });

            if (this.model.get('_media').source) {
                var media = this.model.get('_media');

                // Avoid loading of Mixed Content (insecure content on a secure page)
                if (window.location.protocol === 'https:' && media.source.indexOf('http:') === 0) {
                    media.source = media.source.replace(/^http\:/, 'https:');
                }

                this.model.set('_media', media);
            }

            this.checkIfResetOnRevisit();
        },

        postRender: function() {
            this.setupPlayer();
        },

        setupPlayer: function() {
            if (!this.model.get('_playerOptions')) this.model.set('_playerOptions', {});

            var modelOptions = this.model.get('_playerOptions');

            if (modelOptions.pluginPath === undefined) modelOptions.pluginPath = 'assets/';
            if(modelOptions.features === undefined) {
                modelOptions.features = ['play','progress','current-time','duration'];
                if (this.model.get('_useClosedCaptions')) {
                    modelOptions.features.unshift('captions');
                }
                if(this.model.get("_transcript").inlineTranscriptBody){
                    modelOptions.features.unshift('transcript');
                }

                // if (this.model.get('_showVolumeControl')) {
                    modelOptions.features.push('volume'); // always include volume
                // }
                // if (this.model.get("_allowFullScreen")) {
                    modelOptions.features.push('fullscreen'); // always include fullscreen
                // }
            }

            /*
            Unless we are on Android/iOS and using native controls, when MediaElementJS initializes the player
            it will invoke the success callback prior to performing one last call to setPlayerSize.
            This call to setPlayerSize is deferred by 50ms so we add a delay of 100ms here to ensure that
            we don't invoke setReadyStatus until the player is definitely finished rendering.
            */
            modelOptions.success = _.debounce(this.onPlayerReady.bind(this), 100);

            if (this.model.get('_useClosedCaptions')) {
                var startLanguage = this.model.get('_startLanguage') || 'en';
                if (!Adapt.offlineStorage.get('captions')) {
                    Adapt.offlineStorage.set('captions', startLanguage);
                }
                modelOptions.startLanguage = this.checkForSupportedCCLanguage(Adapt.offlineStorage.get('captions'));
            }

            if (modelOptions.alwaysShowControls === undefined) {
                modelOptions.alwaysShowControls = false;
            }
            if (modelOptions.hideVideoControlsOnLoad === undefined) {
                modelOptions.hideVideoControlsOnLoad = true;
            }

            this.addMediaTypeClass();

            
            var _media = this.model.get('_media');
            if(_media.cc){
                var tracks = [];
                $.each(_media.cc, function(index, track){

                    if(track.src){
                        var captions = {
                            kind: 'captions',
                            label: track.captionLabel,
                            srclang: track.srclang,
                            src: './' + track.src,
                            default: true,
                        }
                        tracks.push(captions);
                    }

                    if(track.descSrc){
                        var descriptions = {
                            kind: 'descriptions',
                            label: track.descLabel,
                            srclang: track.srclang,
                            src: './' + track.descSrc,
                            default: true,
                        }
                        tracks.push(descriptions);
                    }
                    
                })
                modelOptions.tracks = tracks;
            }
            
            this.mediaElement = this.$('.external-source, video, audio').createPlyr(modelOptions);
            
            // if no media is selected - set ready now, as success won't be called
            if (!_media.mp3 && !_media.mp4 && !_media.ogv && !_media.webm && !_media.source) {
                Adapt.log.warn("ERROR! No media is selected in components.json for component " + this.model.get('_id'));
                this.setReadyStatus();
                return;
            }
            // Setup audio descriptor
            
            new AudioDescriptor(this.mediaElement.media, false, "audioDesc-" + this.model.get('_id'));
            this.onPlayerReady(this.mediaElement);
        },

        addMediaTypeClass: function() {
            var media = this.model.get("_media");
            if (media && media.type) {
                var typeClass = media.type.replace(/\//, "-");
                this.$(".media-widget").addClass(typeClass);
            }
        },


        setupEventListeners: function() {
            this.completionEvent = (this.model.get('_setCompletionOn') || 'play');
            // console.log('DEFAULT', this.completionEvent);
            if (this.completionEvent === 'inview') {
                this.setupInviewCompletion('.component-widget');
            }

            // wrapper to check if preventForwardScrubbing is turned on.
            if ((this.model.get('_preventForwardScrubbing')) && (!this.model.get('_isComplete'))) {
                $(this.mediaElement).on({
                    'seeking': this.onMediaElementSeeking,
                    'timeupdate': this.onMediaElementTimeUpdate
                });
            }

            // handle other completion events in the event Listeners
            $(this.mediaElement.player).on({
                'play': this.onMediaElementPlay,
                'pause': this.onMediaElementPause,
                'ended': this.onMediaElementEnded,
                'ready': this.onMediaElementReady
            });

            // occasionally the mejs code triggers a click of the captions language
            // selector during setup, this slight delay ensures we skip that
            _.delay(this.listenForCaptionsChange.bind(this), 250);
        },

        /**
         * Sets up the component to detect when the user has changed the captions so that it can store the user's
         * choice in offlineStorage and notify other media components on the same page of the change
         * Also sets the component up to listen for this event from other media components on the same page
         */
        listenForCaptionsChange: function() {
            if(!this.model.get('_useClosedCaptions')) return;

            var selector = this.model.get('_playerOptions').toggleCaptionsButtonWhenOnlyOne ?
                '.mejs-captions-button button' :
                '.mejs-captions-selector';

            this.$(selector).on('click.mediaCaptionsChange', _.debounce(function() {
                var srclang = this.mediaElement.player.selectedTrack ? this.mediaElement.player.selectedTrack.srclang : 'none';
                Adapt.offlineStorage.set('captions', srclang);
                Adapt.trigger('media:captionsChange', this, srclang);
            }.bind(this), 250)); // needs debouncing because the click event fires twice

            this.listenTo(Adapt, 'media:captionsChange', this.onCaptionsChanged);
        },

        /**
         * Handles updating the captions in this instance when learner changes captions in another
         * media component on the same page
         * @param {Backbone.View} view The view instance that triggered the event
         * @param {string} lang The captions language the learner chose in the other media component
         */
        onCaptionsChanged: function(view, lang) {
            if (view && view.cid === this.cid) return; //ignore the event if we triggered it

            lang = this.checkForSupportedCCLanguage(lang);

            this.mediaElement.player.setTrack(lang);

            // because calling player.setTrack doesn't update the cc button's languages popup...
            var $inputs = this.$('.mejs-captions-selector input');
            $inputs.filter(':checked').prop('checked', false);
            $inputs.filter('[value="' + lang + '"]').prop('checked', true);
        },

        /**
         * When the learner selects a captions language in another media component, that language may not be available
         * in this instance, in which case default to the `_startLanguage` if that's set - or "none" if it's not
         * @param {string} lang The language we're being asked to switch to e.g. "de"
         * @return {string} The language we're actually going to switch to - or "none" if there's no good match
         */
        checkForSupportedCCLanguage: function (lang) {
            if (!lang || lang === 'none') return 'none';

            if(_.findWhere(this.model.get('_media').cc, {srclang: lang})) return lang;

            return this.model.get('_startLanguage') || 'none';
        },
        openPopup: function() {
            if (this._isPopupOpen) return;

            this._isPopupOpen = true;

            Adapt.trigger("notify:popup",{
                title: 'Audio Transcript',//this.model.get("_transcript").inlineTranscriptTitle,
                body: this.model.get("_transcript").inlineTranscriptBody
              });
            // pause when popup is open
            Adapt.trigger("media:stop", null);

            this.listenToOnce(Adapt, {
                'popup:closed': this.onPopupClosed
            });
        },

        onPopupClosed: function() {
            // this.$('button[data-plyr=transcript]').focus();
            Adapt.a11y.focus('button[data-plyr=transcript]');
            this._isPopupOpen = false;
        },
        onMediaElementReady: function(event){
            this.mediaElement.player = event.detail.plyr;
            this.setupEventListeners();
            this.setReadyStatus();
        },

        onMediaElementPlay: function(event) {
            this.queueGlobalEvent('play');
            
            Adapt.trigger("media:stop", this);

            if (this.model.get('_pauseWhenOffScreen')) $(this.mediaElement).on('inview', this.onMediaElementInview);

            this.model.set({
                '_isMediaPlaying': true,
                '_isMediaEnded': false
            });
            
            if (this.completionEvent === 'play' ) {
                this.setCompletionStatus();
            }
        },

        onMediaElementPause: function(event) {
            this.queueGlobalEvent('pause');

            $(this.mediaElement).off('inview', this.onMediaElementInview);

            this.model.set('_isMediaPlaying', false);
        },

        onMediaElementEnded: function(event) {
            this.queueGlobalEvent('ended');
            this.$('.sr-helper').text('Media ended');
            this.$('.audioDec').text('');
            
            this.model.set('_isMediaEnded', true);

            if (this.completionEvent === 'ended') {
                this.setCompletionStatus();
            }
        },

        onMediaElementInview: function(event, isInView) {
            if (!isInView && !event.currentTarget.paused) event.currentTarget.pause();
        },

        onMediaElementSeeking: function(event) {
            var maxViewed = this.model.get("_maxViewed");
            if(!maxViewed) {
                maxViewed = 0;
            }
            if (event.target.currentTime > maxViewed) {
                event.target.currentTime = maxViewed;
            }
        },

        onMediaElementTimeUpdate: function(event) {
            var maxViewed = this.model.get("_maxViewed");
            if (!maxViewed) {
                maxViewed = 0;
            }
            if (event.target.currentTime > maxViewed) {
                this.model.set("_maxViewed", event.target.currentTime);
            }
        },


        onMediaStop: function(view) {
            // console.log('stop triggered', this, view)
            // Make sure this view isn't triggering media:stop
            if (view && view.cid === this.cid) return;

            if (!this.mediaElement || !this.mediaElement.player) return;

            // this.mediaElement.player.pause();
            this.mediaElement.pause();

        },
        onEnterfullscreen: function(){
            
        },

        onExitfullscreen: function(){

        },

        onOverlayClick: function() {
            var player = this.mediaElement.player;
            if (!player) return;

            player.play();
        },

        onMediaElementClick: function(event) {
            // Let plyr handle this
        },

        checkIfResetOnRevisit: function() {
            var isResetOnRevisit = this.model.get('_isResetOnRevisit');

            if (isResetOnRevisit) {
                this.model.reset(isResetOnRevisit);
            }
        },

        remove: function() {



            var modelOptions = this.model.get('_playerOptions');
            delete modelOptions.success;

            var media = this.model.get("_media");
            if (media) {
                switch (media.type) {
                case "video/vimeo":
                    this.$("iframe")[0].isRemoved = true;
                }
            }

            if (this.mediaElement && this.mediaElement.player) {
                var player_id = this.mediaElement.player.id;

                this.mediaElement.player.destroy();
            }

            if (this.mediaElement) {
                $(this.mediaElement).off({
                    'play': this.onMediaElementPlay,
                    'pause': this.onMediaElementPause,
                    'ended': this.onMediaElementEnded,
                    'seeking': this.onMediaElementSeeking,
                    'timeupdate': this.onMediaElementTimeUpdate,
                    'inview': this.onMediaElementInview
                });

                this.mediaElement.src = "";
                $(this.mediaElement.pluginElement).remove();
                delete this.mediaElement;
            }

            ComponentView.prototype.remove.call(this);
        },

        onDeviceChanged: function() {
            if (this.model.get('_media').source) {
                // this.$('.mejs-container').width(this.$('.component-widget').width());
            }
        },

        onPlayerReady: function (mediaElement, domObject) {
            this.mediaElement = mediaElement;

            if (!this.mediaElement.player) {
                // this.mediaElement.player =  mejs.players[this.$('.mejs-container').attr('id')];
            }

            if(this.model.has('_startVolume')) {
                // Setting the start volume only works with the Flash-based player if you do it here rather than in setupPlayer
                // this.mediaElement.player.setVolume(parseInt(this.model.get('_startVolume'))/100);
            }
            $('.plyr').removeAttr('tabindex');
            
            this.setReadyStatus();
        },

        onScreenSizeChanged: function() {
            // this.$('audio, video').width(this.$('.component-widget').width());
        },

        onToggleInlineTranscript: function(event) {
            if (this.model.get('_transcript')._setCompletionOnView !== false) {
                    this.setCompletionStatus();
            }
            this.openPopup();
        },

        onExternalTranscriptClicked: function(event) {

            // console.log(this.model.get('_transcript.transcriptLink'));
            $.get(this.model.get('_transcript.transcriptLink'), function(data){
                // console.log(data);
            });
            if (this.model.get('_transcript')._setCompletionOnView !== false) {
                this.setCompletionStatus();
            }
        },

        /**
         * Queue firing a media event to prevent simultaneous events firing, and provide a better indication of how the
         * media  player is behaving
         * @param {string} eventType
         */
        queueGlobalEvent: function(eventType) {
            // console.log('queue', eventType)
            
            var t = Date.now();
            var lastEvent = this.lastEvent || { time: 0 };
            var timeSinceLastEvent = t - lastEvent.time;
            var debounceTime = 500;

            this.lastEvent = {
                time: t,
                type: eventType
            };

            // Clear any existing timeouts
            clearTimeout(this.eventTimeout);

            // Always trigger 'ended' events
            if (eventType === 'ended') {
                return this.triggerGlobalEvent(eventType);
            }

            // Fire the event after a delay, only if another event has not just been fired
            if (timeSinceLastEvent > debounceTime) {
                this.eventTimeout = setTimeout(this.triggerGlobalEvent.bind(this, eventType), debounceTime);
            }
        },

        triggerGlobalEvent: function(eventType) {
            Adapt.trigger('media', {
                isVideo: this.mediaElement.isVideo,
                type: eventType,
                src: this.mediaElement.source,
                platform: this.mediaElement.pluginType
            });
        }

    });

    return Adapt.register('media-plyr', {
        model: ComponentModel.extend({}),// create a new class in the inheritance chain so it can be extended per component type if necessary later
        view: MediaView
    });
});
