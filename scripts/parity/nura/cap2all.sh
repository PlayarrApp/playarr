#!/usr/bin/env bash
# usage: cap2all.sh <theme> <outdir>  capture all 14 screens (dark|light)
H=$(dirname "$0"); T=$1; O=$2
WAIT=45 "$H/pmcap3.sh" $O theme:$T home movies series music calendar-month calendar-week calendar-agenda search film:ca309574-c0f4-4564-bb54-4512eab7e531 series-detail:7ab4ce97-d59e-43d6-8e03-31d4d29a5c90 settings filters profiles actions
