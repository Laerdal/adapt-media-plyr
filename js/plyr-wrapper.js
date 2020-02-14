 require(["libraries/plyr.polyfilled"], function () {
	   require(["Plyr"], function (Plyr) {
		(function($) {
			$.fn.createPlyr = function(options){
				
				var path = window.location.href.split('#')[0]; // works with preview in authoring tool
				var pathWhenBuilt = path.split('index.html')[0]; // when course is built, need to trim the html
				path = pathWhenBuilt ? pathWhenBuilt : path;
				
				var plyrOptions = {
					hideControls: true,
					tooltips:{
						controls:true
					},
					debug: true,
					settings : ['captions', 'speed'],
					seekTime : 3,
					iconUrl: path + 'assets/plyr.svg',
					captions : { active: false },
					volume: 1
				};

				plyrOptions.controls = options.features;
			
				var player = new Plyr(this, plyrOptions);
				return player;
			}
		})($);
	});
});