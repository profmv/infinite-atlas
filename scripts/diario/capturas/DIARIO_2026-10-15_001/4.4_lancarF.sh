#!/bin/bash
cd "$(dirname "$0")"
mkdir -p batF
for g in 0 1 2 3 4 5 6 7; do
  s=""; for j in 0 1 2 3; do n=$((g*4+j)); s="$s cal-$(printf %02d $n)"; done
  node bateria-a1.mjs vivo 24 $s > batF/vivo_$g.jsonl 2> batF/vivo_$g.err &
done
for g in 0 1; do
  s=""; for j in 0 1 2 3; do n=$((g*4+j)); s="$s cal-$(printf %02d $n)"; done
  node bateria-a1.mjs biblia 24 $s > batF/biblia_$g.jsonl 2> batF/biblia_$g.err &
done
for m in S0 S1 S2; do for j in 0 1 2 3; do
  node braco-sigma.mjs $m 48 sig-0$j > batF/braco_${m}_$j.jsonl 2> batF/braco_${m}_$j.err &
done; done
wait
echo fimF
