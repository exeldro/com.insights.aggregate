'use strict';

const Homey = require('homey');
const http = require('http.min');
///api/manager/insights/log/homey:device:b25d241f-fc9d-4316-bcf1-0bee8fd1e271/alarm_motion/entry?start=2017-12-23T23:00:00.000Z&end=2017-12-30T23:00:00.000Z
///api/manager/insights/log/homey:device:d00f7ae7-9534-4817-aff0-f0f49a52fbed/flow_gas/entry?start=2017-12-23T23:00:00.000Z&end=2017-12-30T23:00:00.000Z
class AggregatedInsightsApp extends Homey.App {
	onInit() {
		
		this.log('AggregatedInsightsApp is running...');
		this.log('token:',this.getToken());
		this.refreshAvailableLogs();
		var t = this;
 		setInterval(function(){t.calculateAggregations();}, 10000);
	}


	getToken () {
		return Homey.ManagerSettings.get('apiToken')
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
		this.getLogs().then(logs =>	Homey.ManagerSettings.set('logs', logs.map(log => ({id:log.uri+'/'+log.name,name:log.uriObj.name+'/'+log.label.en}))));
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
		  timeout: 40000,
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
			return;
		}
		if(!aggregations){
			aggregations = [];
		}
		this.calculating = aggregations.length;
		this.log('calculateAggregations');
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
		}
		aggregations.forEach((aggregation, aggregationIndex, aggregations) => {
			if(aggregation.name == Homey.ManagerSettings.get('deleteAggregation')){
				aggregations.splice(aggregationIndex, 1);
				Homey.ManagerSettings.set('aggregations', aggregations);
				Homey.ManagerSettings.set('deleteAggregation',null);
				this.calculating--;
			}else if(!aggregation.next || this.addPeriod(aggregation.next, aggregation.period) < new Date()){
				var start;
				if(aggregation.next){
					start = this.getPeriodStart(aggregation.next, aggregation.period);
				}else{
					//TODO get start from logs
					start = this.getPeriodStart(new Date(), aggregation.period);
				}
				var end = new Date(this.addPeriod(start, aggregation.period));
				//this.log("calc "+ aggregation.name +" "+start+" "+end);
				var p = [];
				aggregations[aggregationIndex].logs.forEach((log, logIndex) => {
					p.push({
						promise: this.getLog(log.id,start,end),
						index: logIndex,
						id: log.id,
						lastValue: log.lastValue
					});
				});
				Promise.all(p.map(r=>r.promise)).then(results=>{
					//this.log('got all logs');
					var logValue = null;
					if(aggregation.method.toLowerCase() == 'sum'){
						logValue = 0;
						results.forEach((result, i) => {
							this.parseLog(result).forEach(logItem => {
								logValue += logItem.value;
								aggregations[aggregationIndex].logs[i].lastValue = logItem.value;
							});
						});
					}else if(aggregation.method.toLowerCase() == 'min'){
						results.forEach((result, i) => {
							this.parseLog(result).forEach(logItem => {if(logValue === null || logItem.value < logValue){
								logValue = logItem.value;
								aggregations[aggregationIndex].logs[i].lastValue = logItem.value;
							}});
						});
					}else if(aggregation.method.toLowerCase() == 'max'){
						results.forEach((result, i) => {
							this.parseLog(result).forEach(logItem => {if(logValue === null || logItem.value > logValue){
								logValue = logItem.value;
								aggregations[aggregationIndex].logs[i].lastValue = logItem.value;
							}});
						});
					}else if(aggregation.method.toLowerCase() == 'avarage'){
						logValue = 0;
						results.forEach((result, i) => {
							var logItems = this.parseLog(result);
							if(p[i].lastValue){
								if(logItems.length == 0){
									logValue += p[i].lastValue * (end.valueOf() - start.valueOf());
								}else if(logItems[0].date > start){
									logValue += p[i].lastValue * (logItems[0].date.valueOf() - start.valueOf());
								}
							}
							logItems.forEach((logItem, itemIndex) => {
								if(itemIndex == logItems.length-1){
									// last item
									logValue += logItem.value * (end.valueOf() - logItem.date.valueOf());
								}else{
									logValue += logItem.value * (logItems[itemIndex+1].date.valueOf() - logItem.date.valueOf());
								}
								aggregations[aggregationIndex].logs[i].lastValue = logItem.value;
							});
						});
						logValue /= results.length;
						logValue /= (end.valueOf() - start.valueOf());
					}else if(aggregation.method.toLowerCase() == 'difference'){
						logValue = 0;
						results.forEach((result, i) => {
							var logItems = this.parseLog(result);
							if(logItems.length > 0){
								if(p[i].lastValue){
									logValue += logItems[logItems.length-1]-p[i].lastValue;
								}
								aggregations[aggregationIndex].logs[i].lastValue = logItems[logItems.length-1];
							}
						});
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
						//aggregation.name
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
										this.log(err);
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
					}
					aggregations[aggregationIndex].next = end;
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