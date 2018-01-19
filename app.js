'use strict';

const Homey = require('homey');
const http = require('http.min');
class AggregatedInsightsApp extends Homey.App {
	onInit() {
		
		this.log('AggregatedInsightsApp is running...');
		Homey.ManagerApi.getOwnerApiToken().then(apiToken =>{
			Homey.ManagerSettings.set('apiToken', apiToken);
			this.log('token:',apiToken);
			this.refreshAvailableLogs();
		});
		var t = this;
 		setInterval(function(){t.calculateAggregations();}, 10000);
	}


	getToken () {
		return Homey.ManagerSettings.get('apiToken');
	}

	getLogs () {
		return this.api('/manager/insights/log', true);
	}

	getLog(logId,start,end){
		var uri = '/manager/insights/log/'+logId+'/entry';
		if(start){
			uri += '?start='+start.toISOString();
			if(end){
				uri += '&end='+end.toISOString();
			}
		}
		return this.api(uri, false);
	}
	parseLog(data){
		var items = [];
		var lines = data.match(/[^\r\n]+/g);
		if(lines){
			lines.forEach(line => {
				var s = line.split(',');
				if(s.length == 2){
					items.push({date: new Date(s[0]), value: Number(s[1])});
				}
			});
		}
		return items;
	}

	refreshAvailableLogs(){
		this.getLogs().then(logs =>	{
			var logMap = logs.map(log => ({id:log.uri+'/'+log.name,name:(log.uriObj.name?log.uriObj.name:log.uri)+'/'+log.label.en}));
			Homey.ManagerSettings.set('logs', logMap);
			//console.log(logs);
		}).catch(err => {
			console.error(err);
		});
	}
	  

	api(path, json) {
		return this.apiRaw(path, json)
		  .then(result => {
			var data = result.data
			var statusCode = result.response.statusCode
			if (statusCode >= 200 && statusCode < 400) {
			  if(json){
				  return data.result;
			  }else{
				  return data;
			  }
			} else {
			  return Promise.reject((data && data.result) || data)
			}
		  })
	}

	apiRaw(path, json) {
		var bearerToken = this.getToken()
		var options = {
		  uri: `http://127.0.0.1/api${path}`,
		  timeout: 120000,
		  json: json
		}
		if (bearerToken) {
		  options.headers = {
			authorization: `Bearer ${bearerToken}`
		  }
		}
		return http['get'](options)
	  }
	  calculateAggregations(){
		var aggregations = this.getAggregations();
		if(this.calculating){
			this.log('Waiting for '+this.calculating+' calculations to finish.');
			Homey.ManagerApi.realtime('aggregateLog', 'Waiting for '+this.calculating+' calculations to finish.');
			return;
		}
		if(!aggregations){
			aggregations = [];
		}
		this.calculating = aggregations.length;
		this.log('checking '+aggregations.length+' aggregations for updates');
		Homey.ManagerApi.realtime('aggregateLog', 'checking '+aggregations.length+' aggregations for updates');		var addAggregation = Homey.ManagerSettings.get('addAggregation');
		var addAggregation = Homey.ManagerSettings.get('addAggregation');
		if(addAggregation){
			var aggregationIndex = -1;
            aggregations.forEach((a,i) => {
              if(a.name == addAggregation.name){
                aggregationIndex = i;
              }
			});
			if(aggregationIndex == -1){
				aggregations.push(addAggregation);
				this.calculating++;
			}else{
				aggregations[aggregationIndex].label = addAggregation.label;
				aggregations[aggregationIndex].units = addAggregation.units;
				aggregations[aggregationIndex].decimals = addAggregation.decimals;
				addAggregation.logs.forEach(addLog =>{
					var logIndex = -1;
					aggregations[aggregationIndex].logs.forEach((a,i) => {
						if(a.id == addLog.id){
							logIndex = i;
						}
					});
					if(logIndex == -1){
						aggregations[aggregationIndex].logs.push(addLog);
					}else{
						aggregations[aggregationIndex].logs[logIndex] = addLog;
					}
				});
			}
			Homey.ManagerSettings.set('aggregations', aggregations);
			Homey.ManagerSettings.set('addAggregation', null);
			this.log('added aggregation '+ addAggregation.name);
			Homey.ManagerApi.realtime('aggregateLog', 'added aggregation '+ addAggregation.name);
		}
		aggregations.forEach((aggregation, aggregationIndex, aggregations) => {
			if(aggregation.name == Homey.ManagerSettings.get('deleteAggregation')){
				aggregations.splice(aggregationIndex, 1);
				Homey.ManagerSettings.set('aggregations', aggregations);
				Homey.ManagerSettings.set('deleteAggregation',null);
				this.log('deleted aggregation '+ aggregation.name);
				Homey.ManagerInsights.getLog(aggregation.name, function(err, logs) {
					if (err) {
					}else{
						Homey.ManagerInsights.deleteLog(logs, function callback(err, logs) {
							if (err) {
								console.error(err);
							}else{
							}
						});
					}
				});
				Homey.ManagerApi.realtime('aggregateLog', 'deleted aggregation '+ aggregation.name);
				this.calculating--;
			}else if(aggregation.name == Homey.ManagerSettings.get('recalcAggregation') && aggregation.start){
				Homey.ManagerInsights.getLog(aggregation.name, function(err, logs) {
					if (err) {
						aggregations[aggregationIndex].next = aggregations[aggregationIndex].start;
						aggregations[aggregationIndex].nextEnd = null;
						Homey.ManagerSettings.set('aggregations', aggregations);
						Homey.ManagerSettings.set('recalcAggregation',null);
					}else{
						Homey.ManagerInsights.deleteLog(logs, function callback(err, logs) {
							if (err) {
								console.error(err);
							}else{
								aggregations[aggregationIndex].next = aggregations[aggregationIndex].start;
								aggregations[aggregationIndex].nextEnd = null;
								Homey.ManagerSettings.set('aggregations', aggregations);
								Homey.ManagerSettings.set('recalcAggregation',null);
							}
						});
					}
				});
				this.calculating--;	
			}else if((!aggregation.next || this.addPeriod(aggregation.next, aggregation.period) < new Date()) && (!aggregation.nextEnd || new Date(aggregation.nextEnd) < new Date())){
				var start;
				if(aggregation.next){
					start = this.getPeriodStart(aggregation.next, aggregation.period);
				}else if(aggregation.next){
					start = this.getPeriodStart(aggregation.start, aggregation.period);
				}else{
					//TODO get start from logs
					start = this.getPeriodStart(new Date(), aggregation.period);
				}
				var end = new Date(this.addPeriod(start, aggregation.period));
				var nextEnd = new Date(this.addPeriodNextLog(end, aggregation.period));
				if(aggregation.nextEnd && new Date(aggregation.nextEnd) > nextEnd){
					nextEnd = new Date(aggregation.nextEnd);
				}
				//this.log("calc "+ aggregation.name +" "+start+" "+end);
				var p = [];
				aggregations[aggregationIndex].logs.forEach((log, logIndex) => {
					p.push({
						promise: this.getLog(log.id,start,nextEnd),
						index: logIndex,
						id: log.id,
						lastValue: log.lastValue,
						position: (log.position?log.position:aggregations[aggregationIndex].position)
					});
				});
				Promise.all(p.map(r=>r.promise)).then(results=>{
					//this.log('got all logs');
					var allLogsComplete = true;
					results.forEach((result, i) => {
						var logItems = this.parseLog(result);
						var logComplete = false;
						logItems.forEach((logItem, itemIndex) => {
							if(logItem.date >= end){
								logComplete = true;
							}
						});
						if(!logComplete){
							allLogsComplete = false;
						}
					});
					if(!allLogsComplete){
						if(nextEnd == this.addPeriodNextLog(end, aggregation.period)){
							//first time not complete
							this.log("first time missing logs for "+aggregations[aggregationIndex].name);
							Homey.ManagerApi.realtime('aggregateLog', "first time missing logs for "+aggregations[aggregationIndex].name);

							let notUptodateTrigger = new Homey.FlowCardTrigger('not_uptodate');
							notUptodateTrigger.register().trigger({'name': aggregations[aggregationIndex].name}).catch( this.error ).then();
						}else{
							this.log("missing logs for "+aggregations[aggregationIndex].name);
							Homey.ManagerApi.realtime('aggregateLog', "missing logs for "+aggregations[aggregationIndex].name);
						}
						if(nextEnd < new Date()){
							if(this.addPeriod(nextEnd, aggregation.period) < new Date()){
								aggregations[aggregationIndex].nextEnd = this.addPeriod(nextEnd, aggregation.period);
								this.log("added period to "+nextEnd);
							}else{
								aggregations[aggregationIndex].nextEnd = this.addPeriodNextLog(nextEnd, aggregation.period);
								this.log("added nextlog period to " + nextEnd);
							}
						}
					}else{
						var logValue = null;
						if(aggregation.method.toLowerCase() == 'sum'){
							logValue = 0;
							results.forEach((result, i) => {
								this.parseLog(result).forEach(logItem => {
									if(logItem.date >= start && logItem.date < end){
										logValue += logItem.value;
										aggregations[aggregationIndex].logs[i].lastValue = logItem.value;
									}
								});
							});
						}else if(aggregation.method.toLowerCase() == 'min'){
							results.forEach((result, i) => {
								this.parseLog(result).forEach(logItem => {
									if(logItem.date >= start && logItem.date < end && (logValue === null || logItem.value < logValue)){
										logValue = logItem.value;
										aggregations[aggregationIndex].logs[i].lastValue = logItem.value;
									}
								});
							});
						}else if(aggregation.method.toLowerCase() == 'max'){
							results.forEach((result, i) => {
								this.parseLog(result).forEach(logItem => {
									if(logItem.date >= start && logItem.date < end && (logValue === null || logItem.value > logValue)){
										logValue = logItem.value;
										aggregations[aggregationIndex].logs[i].lastValue = logItem.value;
									}
								});
							});
						}else if(aggregation.method.toLowerCase() == 'avarage'){
							logValue = 0;
							results.forEach((result, i) => {
								var logItems = this.parseLog(result);
								if(p[i].position.toLowerCase() == 'start'){
									if(p[i].lastValue){
										if(logItems.length == 0){
											logValue += p[i].lastValue * (end.valueOf() - start.valueOf());
										}else if(logItems[0].date > start){
											if(logItems[0].date >= end){
												logValue += p[i].lastValue * (end.valueOf() - start.valueOf());
											}else{
												logValue += p[i].lastValue * (logItems[0].date.valueOf() - start.valueOf());
											}
										}
									}
									logItems.forEach((logItem, itemIndex) => {
										if(logItem.date >= start && logItem.date < end){
											if(itemIndex == logItems.length-1 || logItems[itemIndex+1].date >= end){
												// last item
												logValue += logItem.value * (end.valueOf() - logItem.date.valueOf());
											}else{
												logValue += logItem.value * (logItems[itemIndex+1].date.valueOf() - logItem.date.valueOf());
											}
											aggregations[aggregationIndex].logs[i].lastValue = logItem.value;
										}
									});
								}else if(p[i].position.toLowerCase() == 'end'){
									logItems.forEach((logItem, itemIndex) => {
										if(itemIndex == 0){
											if(logItem.date >= end){
												logValue += logItem.value * (end.valueOf()-start.valueOf());
											}else{
												logValue += logItem.value * (logItem.date.valueOf()-start.valueOf());
											}
										}else{
											if(logItem.date >= end){
												logValue += logItem.value * (end.valueOf() - logItems[itemIndex-1].date.valueOf()) ;
											}else{
												logValue += logItem.value * (logItem.date.valueOf() - logItems[itemIndex-1].date.valueOf());
											}
										}
									});
								}
							});
							logValue /= results.length;
							logValue /= (end.valueOf() - start.valueOf());
						}else if(aggregation.method.toLowerCase() == 'difference'){
							logValue = 0;
							results.forEach((result, i) => {
								var logItems = this.parseLog(result);
								var endItemIndex = -1;
								logItems.forEach((logItem, itemIndex) => {
									if(logItem.date >= start && logItem.date < end){
										endItemIndex = itemIndex;
									}
								});

								if(endItemIndex >= 0){
									if(!isNaN(p[i].lastValue)){
										logValue += logItems[endItemIndex].value-p[i].lastValue;
									}

									aggregations[aggregationIndex].logs[i].lastValue = logItems[endItemIndex].value;
								}
							});
						}else if(aggregation.method.toLowerCase() == 'median'){
							var values = [];
							results.forEach((result, i) => {
								var logItems = this.parseLog(result);
								logItems.forEach((logItem, itemIndex) => {
									if(logItem.date >= start && logItem.date < end){
										values.push(logItem.value);
									}
								});
							});
							if(values.length > 0){
								values.sort(function(a, b){return a-b});
								if(values.length % 2 == 0){
									logValue = (values[(values.length/2)-1] + values[(values.length/2)])/2;
								}else{
									logValue = values[(((values.length+1)/2)-1)];
								}
							}else{
								logValue = 0;
							}
						}
						if(logValue !== null){
							var logDate = start;
							if(aggregation.position.toLowerCase() == 'start'){
								logDate = start;
							}else if(aggregation.position.toLowerCase() == 'middle'){
								logDate = new Date((start.valueOf()+end.valueOf())/2);
							}else if(aggregation.position.toLowerCase() == 'end'){
								logDate = end;
							}
							this.log(aggregation.name+" log value:"+logValue+" "+logDate);
							Homey.ManagerApi.realtime('aggregateLog', aggregation.name+" log value:"+logValue+" "+logDate);
							Homey.ManagerInsights.getLog(aggregation.name, function(err, logs) {
								if (err !== null) {
									Homey.ManagerInsights.createLog(
										aggregation.name, {
										label: {
											en: aggregation.label
										},
										type: 'number',
										decimals: aggregation.decimals,
										units: aggregation.units
									}, function callback(err, logs) {
										if (err) {
											console.error(err);
										}else{
											logs.createEntry( logValue, logDate, function(err, success) {
												if (err) console.error(err);
											});
										}
									});
								}else{
									logs.createEntry( logValue, logDate, function(err, success) {
										if (err) console.error(err);
									});
								}
							});
							let newAggregationTrigger = new Homey.FlowCardTrigger('new_aggregation_value');
							let tokens = {
								'name': aggregation.name,
								'value': logValue,
								'date': logDate.toISOString()
							};
							newAggregationTrigger.register().trigger(tokens).catch( this.error ).then();
						}
						aggregations[aggregationIndex].next = end;
						if(nextEnd > this.addPeriod(end, aggregation.period)){
							aggregations[aggregationIndex].nextEnd = nextEnd;
						}else{
							if(this.addPeriod(this.addPeriod(end, aggregation.period), aggregation.period) < new Date()){
								aggregations[aggregationIndex].nextEnd = this.addPeriod(this.addPeriod(end, aggregation.period), aggregation.period);
							}else{
								aggregations[aggregationIndex].nextEnd = this.addPeriodNextLog(this.addPeriod(end, aggregation.period), aggregation.period);
							}
						}
					}
					Homey.ManagerSettings.set('aggregations', aggregations);
					this.calculating--;
				}).catch(err => {
					this.log(err);
					this.calculating = 0;
				});
			}else{
				this.calculating--;
				//this.log("skip " + aggregation.name+" next "+new Date(aggregation.next));
			}
		  });
	  }

	  addPeriod(date, periodName){
		var newDate = new Date(date);
		if(periodName.toLowerCase() == 'hour'){
			newDate.setHours(newDate.getHours() + 1);
		}else if(periodName.toLowerCase() == 'day'){
			newDate.setDate(newDate.getDate() + 1);
		}else if(periodName.toLowerCase() == 'week'){
			newDate.setDate(newDate.getDate() + 7);
		}else if(periodName.toLowerCase() == 'month'){
			newDate.setMonth(newDate.getMonth() + 1);
		}else if(periodName.toLowerCase() == 'year'){
			newDate.setFullYear(newDate.getFullYear() + 1);
		}
		if(periodName.toLowerCase() != 'hour'){
			//compensate for summertime
			if(newDate.getHours() >= 22){
				newDate.setDate(newDate.getDate() + 1);
				newDate.setHours(0);
			}else{
				newDate.setHours(0);
			}
		}
		return newDate;
	  }

	  addPeriodNextLog(date, periodName){
		var newDate = new Date(date);
		if(periodName.toLowerCase() == 'hour'){
			newDate.setMinutes(newDate.getMinutes() + 5);
		}else if(periodName.toLowerCase() == 'day'){
			newDate.setHours(newDate.getHours() + 1);
		}else if(periodName.toLowerCase() == 'week'){
			newDate.setHours(newDate.getHours() + 12);
		}else if(periodName.toLowerCase() == 'month'){
			newDate.setDate(newDate.getDate() + 1);
		}else if(periodName.toLowerCase() == 'year'){
			newDate.setDate(newDate.getDate() + 7);
		}else{
			newDate.setMinutes(newDate.getMinutes() + 5);
		}
		return newDate;
	  }

	  getPeriodStart(date, periodName){
		var oldDate = new Date(date);
		if(periodName.toLowerCase() == 'hour'){
			return new Date(oldDate.getFullYear(), oldDate.getMonth(), oldDate.getDate(), oldDate.getHours(), 0, 0, 0);
		}
		if(periodName.toLowerCase() == 'day'){
			return new Date(oldDate.getFullYear(), oldDate.getMonth(), oldDate.getDate(), 0, 0, 0, 0);
		}
		if(periodName.toLowerCase() == 'week'){
			return new Date(oldDate.getFullYear(), oldDate.getMonth(), oldDate.getDate() - oldDate.getDay(), 0, 0, 0, 0);
		}
		if(periodName.toLowerCase() == 'month'){
			return new Date(oldDate.getFullYear(), oldDate.getMonth(), 1, 0, 0, 0, 0);
		}
		if(periodName.toLowerCase() == 'year'){
			return new Date(oldDate.getFullYear(), 1, 1, 0, 0, 0, 0);
		}
		return oldDate;
	  }

	  getAggregations(){
		  return Homey.ManagerSettings.get('aggregations');
	  }
}

module.exports = AggregatedInsightsApp;