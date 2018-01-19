# Aggregated Insights

Allows you to create aggregations of insight logs and aggregations of aggregations.
The app needs permissions to get the logs from other apps.

## Examples
* count of door open event: sum a door open boolean log
* power usage: differencing the meter readings
* average temperture: add multiple temperature logs to 1 aggregation

## Settings
### Name
The name of the aggregation must be unique.
### Label
Display name of the aggregation, multiple languages are not supported yet.
### Units
Units of the values, e.g. °C
### Decimals
Number of decimals visible
### Logs
The logs used for the aggregation
### Start
The start date and time of the first period of the aggregation
### Next
The start date and time of the next period to be calculated
### Period
Aggregations are made per hour, day, week, month or year
### Position
Position in the period the aggregation is logged.
### Method
The aggregation method.
* Sum of all values in the period
* Average of all values in the period by duration after the log record
* Difference between the previous last value and the last value of the period
* Min(imum) value in the period
* Max(imum) value in the period
* Median value in the period

## Versions
* 0.0.6 fix difference aggregation, add 2 flow triggers
* 0.0.5 display date and time in local format, fix bug not getting logs on first start, add median aggregation 
* 0.0.4 more user feedback on settings page
* 0.0.3 support log position per aggregated log
* 0.0.2 replaced bearertoken with apitoken
* 0.0.1 Initial version

## Donate
If you like the app, buy me a beer!  
[![Paypal donate][pp-donate-image]][pp-donate-link]

[pp-donate-link]: https://www.paypal.me/basvm
[pp-donate-image]: https://www.paypalobjects.com/en_US/i/btn/btn_donateCC_LG.gif
